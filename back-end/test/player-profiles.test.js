"use strict";

const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { expect } = require("chai");
const request = require("supertest");
const { createApp } = require("../src/app");
const { readConfig } = require("../src/config");
const { connectDatabase } = require("../src/database");
const { dummyPasswordHash, issueSession } = require("../src/security");
const { buildChatContext } = require("../src/services/buildChatContext");
const { ensurePlayerProfile, grantProfileUnlocks } = require("../src/services/playerProfiles");
const { getStoryFact } = require("../src/data/storyFacts");

const sharedFactId = "ancient-gold-coin-first-assignment";
const futureFactId = "ancient-gold-coin-outcome";

describe("MongoDB player profiles and NPC access", function () {
  let database, models, config, app;
  const calls = [];
  const dbName = `abf_profile_test_${randomBytes(8).toString("hex")}`;
  const logger = { error() {} };

  const generateChatReply = async (input) => {
    calls.push({ ...input, prompt: buildChatContext(input) });
    return "Let us look at what we know.";
  };

  before(async function () {
    const mongodbUri = process.env.TEST_MONGODB_URI;
    if (!mongodbUri) return this.skip();
    config = readConfig({ MONGODB_URI: mongodbUri, JWT_SECRET: "p".repeat(64), MONGODB_DB_NAME: dbName });
    database = await connectDatabase(config);
    models = database.models;
  });

  beforeEach(() => {
    calls.length = 0;
    if (models) app = createApp({ config, models, logger, generateChatReply });
  });

  afterEach(async () => {
    if (models) await Promise.all(Object.values(models).map((model) => model.deleteMany({})));
  });

  after(async () => {
    if (!database) return;
    try {
      expect(database.connection.name).to.equal(dbName);
      expect(dbName).to.match(/^abf_profile_test_[a-f0-9]{16}$/);
      await database.connection.dropDatabase();
    } finally {
      await database.connection.close();
    }
  });

  async function player(email = "player@example.com") {
    const user = await models.User.create({ email, passwordHash: dummyPasswordHash });
    const session = issueSession(user, config);
    await models.Session.create({ userId: user._id, tokenHash: session.tokenHash, expiresAt: session.expiresAt });
    return { user, cookie: `${config.cookieName}=${session.token}` };
  }

  const characters = (cookie, targetApp = app) => request(targetApp).get("/api/game/characters").set("Cookie", cookie);
  const send = (cookie, characterId = "cislo", data = {}) => request(app)
    .post(`/api/game/chat/${characterId}`).set("Cookie", cookie)
    .send({ mode: "story", message: "What do you know?", ...data });

  it("requires an authenticated account and never creates a guest profile", async () => {
    for (const path of ["/api/game/characters", "/api/game/chat/cislo?mode=daily"]) {
      await request(app).get(path).expect(401);
      await request(app).get(path).set("Cookie", `${config.cookieName}=invalid`).expect(401);
    }
    await request(app).post("/api/game/chat/cislo")
      .send({ mode: "daily", message: "Hello" }).expect(401);
    expect(await models.PlayerProfile.countDocuments()).to.equal(0);
    expect(calls).to.have.length(0);
  });

  it("lazily creates exactly one profile with Cislo and no story facts", async () => {
    const { user, cookie } = await player();
    expect(await models.PlayerProfile.countDocuments()).to.equal(0);
    const responses = await Promise.all(Array.from({ length: 6 }, () => characters(cookie).expect(200)));
    expect(await models.PlayerProfile.countDocuments({ userId: user._id })).to.equal(1);
    const profile = await models.PlayerProfile.findOne({ userId: user._id }).lean();
    expect(profile.characterProgress.map((entry) => entry.characterId)).to.deep.equal(["cislo"]);
    expect(profile.characterProgress[0].relationshipTier).to.equal("reserved");
    expect(profile.storyUnlocks).to.deep.equal([]);
    for (const { body } of responses) {
      expect(body.characters.map((entry) => entry.name)).to.deep.equal(["cislo"]);
      expect(body.characters[0].unlockedAt).to.equal(profile.characterProgress[0].unlockedAt.toISOString());
      expect(body.progress).to.deep.equal({ unlockedCharacters: 1, unlockedFacts: 0 });
      expect(body).not.to.have.any.keys("passwordHash", "email", "jwtSecret");
    }
    const indexes = await models.PlayerProfile.collection.indexes();
    expect(indexes.find((index) => index.key.userId === 1).unique).to.equal(true);
  });

  it("preserves first unlock dates and does not double-count concurrent grants", async () => {
    const { user, cookie } = await player();
    const first = await grantProfileUnlocks(models, user._id, { characterIds: ["ona"], factIds: [sharedFactId] });
    const firstDates = first.characterProgress.map((entry) => [entry.characterId, entry.unlockedAt.toISOString()]);
    const firstFactDate = first.storyUnlocks[0].unlockedAt.toISOString();
    await Promise.all(Array.from({ length: 6 }, () => grantProfileUnlocks(models, user._id, {
      characterIds: ["ona", "ona", "ivan"], factIds: [sharedFactId, futureFactId, futureFactId],
    })));
    const profile = await ensurePlayerProfile(models, user._id);
    expect(profile.characterProgress.map((entry) => entry.characterId).sort()).to.deep.equal(["cislo", "ivan", "ona"]);
    expect(profile.storyUnlocks.map((entry) => entry.factId).sort()).to.deep.equal([sharedFactId, futureFactId].sort());
    for (const [characterId, unlockedAt] of firstDates) {
      expect(profile.characterProgress.find((entry) => entry.characterId === characterId).unlockedAt.toISOString()).to.equal(unlockedAt);
    }
    expect(profile.storyUnlocks.find((entry) => entry.factId === sharedFactId).unlockedAt.toISOString()).to.equal(firstFactDate);
    expect((await characters(cookie).expect(200)).body.progress).to.deep.equal({ unlockedCharacters: 3, unlockedFacts: 2 });
  });

  it("validates the complete grant before creating or changing a profile", async () => {
    const { user } = await player();
    await assert.rejects(grantProfileUnlocks(models, user._id, {
      characterIds: ["ona", "unknown"], factIds: [sharedFactId],
    }));
    expect(await models.PlayerProfile.countDocuments()).to.equal(0);
    await ensurePlayerProfile(models, user._id);
    await assert.rejects(grantProfileUnlocks(models, user._id, {
      characterIds: ["ona"], factIds: [sharedFactId, "unknown"],
    }));
    const profile = await models.PlayerProfile.findOne({ userId: user._id }).lean();
    expect(profile.characterProgress.map((entry) => entry.characterId)).to.deep.equal(["cislo"]);
    expect(profile.storyUnlocks).to.deep.equal([]);
  });

  it("keeps two accounts separate and rejects direct requests for locked NPCs", async () => {
    const first = await player("first@example.com");
    const second = await player("second@example.com");
    await grantProfileUnlocks(models, first.user._id, { characterIds: ["ona"], factIds: [sharedFactId] });
    expect((await characters(first.cookie).expect(200)).body.characters.map((entry) => entry.name)).to.have.members(["cislo", "ona"]);
    expect((await characters(second.cookie).expect(200)).body.characters.map((entry) => entry.name)).to.deep.equal(["cislo"]);
    await request(app).get("/api/game/chat/ona?mode=story").set("Cookie", second.cookie).expect(403);
    await send(second.cookie, "ona").expect(403);
    expect(calls).to.have.length(0);
    await send(first.cookie, "ona").expect(200);
    await send(first.cookie, "cislo").expect(200);
    const ownHistory = await request(app).get("/api/game/chat/cislo?mode=story").set("Cookie", first.cookie).expect(200);
    expect(ownHistory.body.messages).to.have.length(2);
    const history = await request(app).get("/api/game/chat/cislo?mode=story").set("Cookie", second.cookie).expect(200);
    expect(history.body.messages).to.deep.equal([]);
  });

  it("ignores user IDs, relationship tiers, and facts supplied by the browser", async () => {
    const privileged = await player("privileged@example.com");
    const ordinary = await player("ordinary@example.com");
    await grantProfileUnlocks(models, privileged.user._id, { characterIds: ["ona"], factIds: [futureFactId] });
    await send(ordinary.cookie, "cislo", {
      userId: privileged.user.id,
      relationshipTier: "more_open",
      unlockedFactIds: [futureFactId],
      trustedContext: { relationshipTier: "more_open", unlockedFacts: ["Forged secret"] },
      page: 21,
    }).expect(200);
    expect(calls[0].trustedContext.relationshipTier).to.equal("reserved");
    expect(calls[0].trustedContext.unlockedFacts).to.deep.equal([]);
    expect(calls[0].prompt.instructions).not.to.contain("Forged secret");
    expect((await characters(ordinary.cookie).expect(200)).body.progress).to.deep.equal({ unlockedCharacters: 1, unlockedFacts: 0 });
  });

  it("uses current permanent facts in both modes and respects each NPC's timeline", async () => {
    const { user, cookie } = await player();
    await send(cookie).expect(200);
    expect(calls[0].trustedContext.unlockedFacts).to.deep.equal([]);
    await grantProfileUnlocks(models, user._id, { characterIds: ["ona", "ivan"], factIds: [sharedFactId, futureFactId] });
    const sharedText = getStoryFact(sharedFactId).text;
    const futureText = getStoryFact(futureFactId).text;
    for (const mode of ["daily", "story"]) {
      for (const characterId of ["cislo", "ona", "ivan"]) {
        await send(cookie, characterId, { mode }).expect(200);
        const call = calls.at(-1);
        expect(call.trustedContext.unlockedFacts).to.include(sharedText);
        expect(call.prompt.instructions).to.include(sharedText);
        if (characterId === "cislo") {
          expect(call.trustedContext.unlockedFacts).to.include(futureText);
          expect(call.prompt.instructions).to.include(futureText);
        } else {
          expect(call.trustedContext.unlockedFacts).not.to.include(futureText);
          expect(call.prompt.instructions).not.to.include(futureText);
        }
      }
    }
  });

  it("retains account progress across app recreation and reads relationship guidance from the profile", async () => {
    const { user, cookie } = await player();
    const granted = await grantProfileUnlocks(models, user._id, { characterIds: ["ivan"], factIds: [futureFactId] });
    await models.PlayerProfile.updateOne({ userId: user._id, "characterProgress.characterId": "cislo" }, {
      $set: { "characterProgress.$.relationshipTier": "more_open" },
    });
    const recreated = createApp({ config, models, logger, generateChatReply });
    const response = await characters(cookie, recreated).expect(200);
    expect(response.body.progress).to.deep.equal({ unlockedCharacters: 2, unlockedFacts: 1 });
    await request(recreated).post("/api/game/chat/cislo").set("Cookie", cookie)
      .send({ mode: "story", message: "Why investigate?", page: 1, relationshipTier: "reserved" }).expect(200);
    expect(calls.at(-1).trustedContext.relationshipTier).to.equal("more_open");
    expect(calls.at(-1).prompt.instructions).to.include("She may explain that she heard the story");
    const profile = await models.PlayerProfile.findOne({ userId: user._id }).lean();
    expect(profile.storyUnlocks).to.deep.equal(granted.storyUnlocks);
    const storedUser = await models.User.findById(user._id).lean();
    expect(storedUser).not.to.have.any.keys("characterProgress", "storyUnlocks", "profileId");
  });
});
