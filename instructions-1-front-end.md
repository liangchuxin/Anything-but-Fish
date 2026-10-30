# Front-End Development

Instructions for **Sprint 1** of the mobile web app software development project.

Each team must have completed and [demo'd](https://knowledge.kitchen/content/courses/agile-development-and-devops/slides/scrum/#91) the working front-end of their group project by the end of the corresponding Sprint.

## Technical requirements

The following requirements outline what must be, must not be, and may be done during the front-end development sprint.

### Musts...

- All front-end code must be generated using React.js.
- All component definitions must be written as **functions**, not as classes.
- All component content must be written using **JSX**, not only plain Javascript.
- Front-end screens must be custom-designed to look clean, contemporary, and sharp, not like a wireframe.
- Any user-generated data or images that will be displayed by your app must be temporarily mocked with a random image API service, such as [Picsum](https://picsum.photos/) or similar.
- Front-ends must include all screens in the completed application and should closely match the clickable prototypes created previously, unless the team believes an alternate user experience is beneficial.
- Ay mismatch between the clickable prototypes and the front-end app code delivered must be explained during the stakeholder demo.
- Any front-end dynamic functionality, such as buttons that change something on the screen when clicked, or search fields that filter results as they are typed into, must be implemented in the front-end, even if the data displayed is only mock data.
- If your app will eventually have user registration and login functionality, all front-end screens to support this must be created, although they can be non-functional for now.
- Instructions on how to set up and run the project must be included in the `README.md` file in version control. It must be possible for anybody to follow the instructions on the `README.md` to build and run the entire project on their local machines.
- Credentials or URIs for logging into databases, APIs, or other remote services, must never be shared in version control. They are usually stored in private settings files, such as `.env` or similar, which are not included in the version control repository.

### May...

- You **may** use the [Vite](https://vite.dev/guide/) build tool to scaffold your initial front-end code structure.
- You **may** use [React Context](https://react.dev/learn/passing-data-deeply-with-context) for sharing state among multiple components.
- You **may** use the front-end framework, [TailwindCSS](https://tailwindcss.com/) with or without [ShadCDN](https://ui.shadcn.com/) to streamline your component designs.
- You **may** use [mockaroo](https://mockaroo.com/mock_apis), [picsum](https://picsum.photos/), various Vite mocking plugins, and/or [other mocking/faking tools](https://www.npmjs.com/search?q=fake%20data) to mock any data that will eventually come from your application's back-end or other external source.

### Must nots...

- You **must not** use any other build tool.
- You **must not** use any other 3rd-party state manager tools, such as [Redux](https://react-redux.js.org/) or [Mobx](https://mobx.js.org/README.html#introduction)
- You **must not** use any other front-end frameworks, including [Material UI](https://material-ui.com/), [Bootstrap](https://react-bootstrap.github.io/).
- You **must not** use [Next.js](https://nextjs.org/) or any other Server-Side Rendering (SSR) framework.
- You **must not** hard-code any data in your front-end code that will eventually be provided by your application's back-end or other external source.

## Grading

Individuals will be graded, in part, according to...

- individual code contributions, as visible through `git log` - it is your responsibility to make sure you commit your own work using your own git/GitHub accounts with the [correct settings](https://knowledge.kitchen/content/courses/software-engineering/slides/git-and-github/#104).
- proper adherence to the [Feature Branch git workflow](https://knowledge.kitchen/content/courses/agile-development-and-devops/slides/feature-branch-workflow/)
- the [proper setup and maintenance of a GitHub repository](./instructions-0c-project-setup.md) that tracks all work
- the [proper coding conventions](https://knowledge.kitchen/content/courses/agile-development-and-devops/conventions/)
- the quality of the work as a whole, given the number of people on the team

Any `.env` files necessary for the functioning of the project must be submitted to admins/managers via the team's messenger channel.
