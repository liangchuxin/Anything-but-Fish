# Contributing

This is the initial draft. Meeting times, role assignments, and shared tools still need to be agreed by the team.

## Team Norms

- Use the course team channel for project discussions and decisions, with course staff included.
- Hold at least three synchronous standups each week, including at least two on weekdays. Keep each standup within 15 minutes.
- The Scrum Master posts one report covering each member's completed work, next steps, blockers, and attendance mode.
- Raise blockers openly. If a member makes no progress for two standups, bring it to the attention of course staff.
- Product Owner and Scrum Master rotate each sprint. Everyone contributes to design and development.

To agree:

- Standup days and times, in New York time
- Sprint 0 Product Owner and Scrum Master
- Shared editor, linter, and coding conventions

## Git Workflow

1. Work in the shared team repository using your own GitHub account and matching Git commit identity.
2. Track work in Issues with `user story`, `task`, or `spike` labels and the relevant `Sprint N` label. Tasks should link to their related User Story.
3. Create a branch for each Task or Spike. Include the Issue number, for example `spike/<issue-number>/<short-name>` or `user-story/<story-number>/task/<task-number>/<short-name>`.
4. Use short, descriptive, single-line commit messages and push the branch regularly.
5. Open a pull request targeting this repository's `main` branch and move the task to Awaiting review.
6. A different teammate reviews, approves, and merges the PR using Create a merge commit. The author does not merge their own PR.

A task is done when the work meets its requirements, the relevant checks pass, and a teammate has reviewed and merged it. Update the task board to reflect its status.

## Local Setup, Building, and Testing

Commands will be added when the initial application is ready.
