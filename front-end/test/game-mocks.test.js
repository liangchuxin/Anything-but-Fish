import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { after, before, beforeEach, test } from "node:test";
import { setupServer } from "msw/node";
import { createGameHandlers } from "../src/mocks/handlers.js";
import { chapterPreview, initialChapterProgress } from "../src/mocks/fixtures/chapter.js";

const baseUrl = "http://game.test/api";
const server = setupServer();
const blockedTransportMessage = "Test-only guard stopped an unhandled request before network access.";
let unhandledRequests = [];

before(() => {
  server.listen({
    onUnhandledFrame({ frame }) {
      // Record unmatched traffic without letting Node connect to an external host.
      const { request } = frame.data;
      unhandledRequests.push({ method: request.method, url: request.url });
      throw new Error(blockedTransportMessage);
    },
  });
});

beforeEach(() => {
  unhandledRequests = [];
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 0 }));
});

after(() => {
  server.close();
});

async function get(resource) {
  const response = await fetch(`${baseUrl}/game/${resource}`);
  return { response, data: await response.json() };
}

async function write(resource, method, body) {
  const response = await fetch(`${baseUrl}/game/${resource}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { response, data: await response.json() };
}

test("standalone demo begins with Cislo and no earned inventory, collections, or chapter archive", async () => {
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 0, mockProgress: true }));
  const plots = await get("plots");
  assert.equal(plots.response.status, 200);
  assert.deepEqual(plots.data.categories.map(({ id, title, entries }) => [id, title, entries.length]), [
    ["characters", "Characters", 1], ["chapters", "Chapters", 0], ["objects", "Objects", 0],
  ]);
  assert.equal(plots.data.categories[0].entries[0].id, "cislo");
  assert.deepEqual((await get("characters")).data, { characters: [{ name: "cislo", displayName: "Cislobog Raskolnikova" }] });
  assert.deepEqual((await get("inventory")).data, { capacity: 20, items: [] });
  assert.deepEqual((await get("collections")).data, { items: [] });
  assert.deepEqual((await get(`chapters/${chapterPreview.id}/progress`)).data, initialChapterProgress);
  assert.equal(plots.response.headers.get("Cache-Control"), "no-store");
  assert.equal(plots.response.headers.get("X-Mock-Data"), "shared-preview");
  assert.deepEqual(unhandledRequests, []);
});

test("reading first appearances unlocks each character and the matching archive entry together", async () => {
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 0, mockProgress: true }));
  const progressPath = `chapters/${chapterPreview.id}/progress`;
  await write(progressPath, "POST", { entryId: 1001 });
  assert.equal((await get("characters")).data.characters.length, 1);
  const ivan = await write(progressPath, "POST", { entryId: 1002 });
  assert.equal(ivan.response.status, 200);
  assert.equal(ivan.data.furthestEntryId, 1002);
  assert.deepEqual((await get("characters")).data.characters.map(({ name }) => name), ["cislo", "ivan"]);
  assert.deepEqual((await get("plots")).data.categories[0].entries.map(({ id }) => id), ["cislo", "ivan"]);
  await write(progressPath, "POST", { entryId: 1003 });
  await write(progressPath, "POST", { entryId: 1003 });
  const earlier = await write(progressPath, "POST", { entryId: 1001 });
  assert.equal(earlier.data.entryId, 1001);
  assert.equal(earlier.data.furthestEntryId, 1003);
  assert.deepEqual((await get("characters")).data.characters.map(({ name }) => name), ["cislo", "ona", "ivan"]);
  assert.deepEqual((await get("plots")).data.categories[0].entries.map(({ id }) => id), ["cislo", "ona", "ivan"]);
  assert.deepEqual((await get("inventory")).data.items, []);
});

test("chapter completion awards one coin and reveals the chapter archive and collection once", async () => {
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 0, mockProgress: true }));
  const chapterPath = `chapters/${chapterPreview.id}`;
  assert.equal((await write(`${chapterPath}/complete`, "POST", {})).response.status, 409);
  for (const entryId of chapterPreview.entryIds) {
    assert.equal((await write(`${chapterPath}/progress`, "POST", { entryId })).response.status, 200);
  }
  const results = await Promise.all(Array.from({ length: 3 }, () => write(`${chapterPath}/complete`, "POST", {})));
  assert.equal(results.filter(({ data }) => !data.alreadyCompleted).length, 1);
  assert.deepEqual(results.flatMap(({ data }) => data.awardedItems), [{ itemId: "ancient-coin", count: 1 }]);
  const inventory = (await get("inventory")).data;
  assert.equal(inventory.capacity, 20);
  assert.deepEqual(inventory.items.map(({ id, icon, count }) => ({ id, icon, count })), [{ id: "ancient-coin", icon: "coin", count: 1 }]);
  assert.deepEqual((await get("collections")).data.items.map(({ id }) => id), ["photo-1"]);
  const categories = (await get("plots")).data.categories;
  assert.deepEqual(categories[1].entries.map(({ id }) => id), ["ancient-gold-coin"]);
  assert.deepEqual(categories[2].entries.map(({ id }) => id), ["ancient-coin"]);
  const finished = (await get(`${chapterPath}/progress`)).data;
  assert.ok(Number.isFinite(Date.parse(finished.completedAt)));
  await write(`${chapterPath}/progress`, "POST", { entryId: 1001 });
  assert.equal((await get(`${chapterPath}/progress`)).data.completedAt, finished.completedAt);
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 0, mockProgress: true }));
  assert.deepEqual((await get("inventory")).data.items, []);
  assert.deepEqual((await get(`${chapterPath}/progress`)).data, initialChapterProgress);
});

test("demo validates chapter requests and rejects skipping unread entries", async () => {
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 0, mockProgress: true }));
  const chapterPath = `chapters/${chapterPreview.id}`;
  for (const body of [null, {}, { entryId: "1001" }, { entryId: 1.5 }, { entryId: 999 }, { entryId: 1001, factIds: ["secret"] }]) {
    assert.equal((await write(`${chapterPath}/progress`, "POST", body)).response.status, 400);
  }
  assert.equal((await write(`${chapterPath}/progress`, "POST", { entryId: 1047 })).response.status, 409);
  assert.equal((await get("chapters/unknown/progress")).response.status, 404);
  assert.equal((await write("chapters/unknown/progress", "POST", { entryId: 1001 })).response.status, 404);
  assert.equal((await write(`${chapterPath}/complete`, "POST", { itemId: "ancient-coin", count: 999 })).response.status, 400);
  assert.deepEqual((await get(`${chapterPath}/progress`)).data, initialChapterProgress);
});

test("empty scenario starts without unlocked content and preserves mock save contracts", async () => {
  server.resetHandlers(...createGameHandlers({ baseUrl, scenario: "empty", delayMs: 0, mockProgress: true }));
  assert.deepEqual((await get("plots")).data, { categories: [
    { id: "characters", title: "Characters", entries: [] },
    { id: "chapters", title: "Chapters", entries: [] },
    { id: "objects", title: "Objects", entries: [] },
  ] });
  assert.deepEqual((await get("characters")).data, { characters: [] });
  assert.deepEqual((await get("inventory")).data, { capacity: 20, items: [] });
  assert.deepEqual((await get("collections")).data, { items: [] });
  assert.deepEqual((await get("saves")).data, { slots: [
    { id: "slot-1", save: null }, { id: "slot-2", save: null }, { id: "slot-3", save: null },
  ] });
});

test("error scenario returns JSON 503 responses for every mocked operation", async () => {
  server.resetHandlers(...createGameHandlers({ baseUrl, scenario: "error", delayMs: 0, mockProgress: true }));
  for (const resource of ["plots", "characters", "inventory", "collections", "saves", `chapters/${chapterPreview.id}/progress`]) {
    const { response, data } = await get(resource);
    assert.equal(response.status, 503);
    assert.equal(data.detail, "The game preview is unavailable in the error scenario.");
  }
  for (const [resource, method, body] of [
    ["saves/slot-3", "PUT", { chapterTitle: "The Coin", page: 4 }],
    ["saves/slot-1/load", "POST"],
    [`chapters/${chapterPreview.id}/progress`, "POST", { entryId: 1001 }],
    [`chapters/${chapterPreview.id}/complete`, "POST", {}],
  ]) {
    const { response, data } = await write(resource, method, body);
    assert.equal(response.status, 503);
    assert.equal(data.detail, "The game preview is unavailable in the error scenario.");
  }
});

test("ordinary development bypasses real account APIs, other origins, and unsupported methods", async () => {
  for (const scenario of ["demo", "empty", "error"]) {
    server.resetHandlers(...createGameHandlers({ baseUrl, scenario, delayMs: 0 }));
    unhandledRequests = [];
    const requests = [
      { method: "GET", url: `${baseUrl}/auth/me` },
      { method: "POST", url: `${baseUrl}/auth/register` },
      { method: "PATCH", url: `${baseUrl}/auth/settings` },
      { method: "GET", url: `${baseUrl}/game/collections` },
      { method: "GET", url: `${baseUrl}/game/plots` },
      { method: "GET", url: `${baseUrl}/game/characters` },
      { method: "GET", url: `${baseUrl}/game/inventory` },
      { method: "GET", url: `${baseUrl}/game/settings` },
      { method: "PATCH", url: `${baseUrl}/game/settings` },
      { method: "GET", url: `${baseUrl}/game/chapters/${chapterPreview.id}/progress` },
      { method: "POST", url: `${baseUrl}/game/chapters/${chapterPreview.id}/progress` },
      { method: "POST", url: `${baseUrl}/game/chapters/${chapterPreview.id}/complete` },
      { method: "GET", url: `${baseUrl}/game/chat/cislo?mode=daily` },
      { method: "POST", url: `${baseUrl}/game/chat/cislo` },
      { method: "GET", url: `${baseUrl}/game/missing` },
      { method: "GET", url: `${baseUrl}/game/plots/extra` },
      { method: "POST", url: `${baseUrl}/game/plots` },
      { method: "POST", url: `${baseUrl}/game/inventory` },
      { method: "DELETE", url: `${baseUrl}/game/saves/slot-1` },
      { method: "POST", url: `${baseUrl}/game/saves/slot-1/load/extra` },
      { method: "GET", url: "http://other.test/api/game/plots" },
      { method: "GET", url: "http://game.test/assets/art.png" },
    ];
    for (const { method, url } of requests) {
      const response = await fetch(url, { method });
      assert.equal(response.status, 500);
      assert.equal((await response.json()).message, blockedTransportMessage);
      assert.equal(response.headers.get("X-Mock-Data"), null);
    }
    assert.deepEqual(unhandledRequests, requests);
  }
});

test("save and load update slot contents in memory with a current timestamp", async () => {
  const initial = (await get("saves")).data;
  assert.equal(initial.slots.length, 3);
  assert.deepEqual(initial.slots.map(({ save }) => save !== null), [true, true, false]);
  assert.equal((await write("saves/slot-3/load", "POST")).response.status, 409);
  const startedAt = Date.now();
  const position = { chapterTitle: "The Coin", page: 4 };
  const saved = await write("saves/slot-3", "PUT", position);
  assert.equal(saved.response.status, 200);
  const savedSlot = saved.data.slots.find(({ id }) => id === "slot-3").save;
  assert.equal(savedSlot.chapterTitle, position.chapterTitle);
  assert.equal(savedSlot.page, position.page);
  assert.ok(Date.parse(savedSlot.savedAt) >= startedAt && Date.parse(savedSlot.savedAt) <= Date.now());
  assert.equal(savedSlot.savedAt, new Date(savedSlot.savedAt).toISOString());
  assert.deepEqual((await get("saves")).data, saved.data);
  assert.deepEqual((await write("saves/slot-3/load", "POST")).data, position);

  const overwritten = { chapterTitle: "The Coin", page: 8 };
  await write("saves/slot-3", "PUT", overwritten);
  assert.deepEqual((await write("saves/slot-3/load", "POST")).data, overwritten);
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 0 }));
  assert.equal((await get("saves")).data.slots[2].save, null);
});

test("invalid saves and unknown slots fail without overwriting progress", async () => {
  const original = (await get("saves")).data;
  for (const body of [
    null, {}, { chapterTitle: "The Coin" }, { chapterTitle: "", page: 1 },
    { chapterTitle: "   ", page: 1 }, { chapterTitle: "The Coin", page: 0 },
    { chapterTitle: "The Coin", page: 1.5 }, { chapterTitle: "The Coin", page: "2" },
    { chapterTitle: "The Coin", page: 2, savedAt: "untrusted" },
  ]) {
    assert.equal((await write("saves/slot-1", "PUT", body)).response.status, 400);
  }
  assert.equal((await write("saves/slot-9", "PUT", { chapterTitle: "The Coin", page: 1 })).response.status, 404);
  assert.equal((await write("saves/slot-9/load", "POST")).response.status, 404);
  assert.deepEqual((await get("saves")).data, original);
});

test("the configured response delay is applied", async () => {
  server.resetHandlers(...createGameHandlers({ baseUrl, delayMs: 40 }));
  const startedAt = performance.now();
  await get("saves");
  assert.ok(performance.now() - startedAt >= 35);
});

test("invalid scenario and delay settings fail before request interception starts", () => {
  assert.throws(() => createGameHandlers({ scenario: "unknown" }), /scenario must be demo, empty, or error/);
  for (const delayMs of [-1, 1.5, 60001, NaN, "250"]) {
    assert.throws(() => createGameHandlers({ delayMs }), /delayMs must be an integer/);
  }
  assert.throws(() => createGameHandlers({ baseUrl: "" }), /baseUrl must be a nonempty string/);
});

test("a custom API base with a trailing slash is matched without broadening interception", async () => {
  server.resetHandlers(...createGameHandlers({ baseUrl: "http://game.test/custom/api/", delayMs: 0, mockProgress: true }));
  const response = await fetch("http://game.test/custom/api/game/characters");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).characters[0].name, "cislo");
  const unmatched = await fetch(`${baseUrl}/game/characters`);
  assert.equal((await unmatched.json()).message, blockedTransportMessage);
  assert.deepEqual(unhandledRequests, [{ method: "GET", url: `${baseUrl}/game/characters` }]);
});
