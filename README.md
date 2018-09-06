# probot-vsts-build

A GitHub App for [VSTS Build](https://visualstudio.com/team-services/),
built with [Probot](https://github.com/probot/probot).

If you have GitHub repositories that store your code, and VSTS build
pipelines that perform CI builds for pull requests, then this app enables
project contributors to requeue pull requests builds just by typing
`/rebuild` as a pull request comment.

![Example of GitHub pull request discussion](https://user-images.githubusercontent.com/1130014/45150803-9c5f5580-b1c4-11e8-8d71-36b86fae0342.png)

This is useful if you have occasionally flaky tests or infrastructure,
and it allows project contributors to requeue a build right from GitHub.
This lets you provide access to requeue a build without necessarily providing
people broader access to the build definition in VSTS.

Note that `/rebuild` is limited to project contributors on GitHub (people
listed in the contributors group, or who are part of a team for this
repository).

## Installation

Since this application will need access to queue builds on your behalf
in Visual Studio Team Services, you will need to set up your own instance
of this application.  There's no publicly available GitHub App instance
that you can just install.

### Create a GitHub App

You'll need to [Create a new GitHub App](https://github.com/settings/apps/new)
for your installation.  Most of the settings are straightforward, but there
are three important considerations:

* **Webhook URL**: This is the URL of your deployed application.  If
  you're deploying to Azure, for example, this will be
  `my-vsts-build-app.azurewebsites.net`.
* **Webhook secret**: Create a secret key of random data that will be used
  to authenticate to your application.
* **Private key**: Generate a new private key and save it to disk.

Make sure that this application is **private** since it will have access
to your VSTS repository, and the ability to queue builds on your behalf.

### Create a VSTS Personal Access Token

A Personal Access Token (PAT) allows you to provide this app the ability
to queue builds on your behalf.  In the VSTS portal, select your settings
in the upper right and select Security.

In the Personal Access Token section, click "Add" to create a new PAT.
Give it a description that is memorable, like "probot-vsts-build".

In "Authorized Scopes", change the option to selected scopes, then select
"Build (read and execute)".  Limiting the scope of an access token is
always good security posture.

Finally, save your new PAT in your password manager of choice.  You'll
need it again for deployment.

### Deploying to Azure using VSTS Build and Deployment Pipelines

It's easy to deploy this to an Azure app service running node.js on Linux.
(Make sure you're using node.js 8.9 or newer.)

1. Fork this repository on GitHub.

2. Set up a new VSTS Build pipeline:

   1. **Location**: GitHub
   2. **Repository**: Select your fork of `probot-vsts-build`
   3. **Template**: Use the suggested Node.js-based build
   4. **Run**: Queue a build

3. Set up a new VSTS Release pipeline:

   1. Create an **Azure App Service Deployment**
   2. Add an artifact: select the **build artifact** produced by your
      build pipeline
   3. Select your stage, and select the stage tasks.  You'll be prompted
      to enter your Azure subscription and app service name.  Change the
      App type to "Linux App" and select your app service name.

4. In the Azure portal, set up the configuration for your application.  In
   application settings, set:

   * **APP_ID**: the ID of your GitHub App
   * **WEBHOOK_SECRET**: the secret key for your GitHub App
   * **PRIVATE_KEY**: the private key file you downloaded when creating
     your GitHub App.
   
      Note that the private key is in PEM format, so it spans multiple lines.
      This environment variable needs to be on a **single line**.  Remove
      the line breaks and replace them with a backslash (`\`) followed by
      an `n`.  Probot will find a literal `\n` and replace it with newlines.
      You can achieve this with Perl:

      `perl -pe 's/\n/\\n/' < pemfile`

   * **VSTS_URL**: the URL of the Visual Studio Team Services account
     that contains the builds that are queued for your GitHub repository.
   * **VSTS_PAT**: your Personal Access Token

### Deploy Manually

If you don't want to set up a VSTS pipeline into Azure, you can run build
and run this application manually.

To download and build the latest release of this application:

```
git clone --branch latest https://github.com/ethomson/probot-vsts-build
cd probot-vsts-build
npm build
```

Refer to the [Probot Deployment
Guide](https://probot.github.io/docs/deployment/) for setting up your
deployment.  This is a standard Probot app, but does require two custom
environment variables:

* **VSTS_URL**: the URL of the Visual Studio Team Services account that
  contains the builds that are queued for your GitHub repository.
* **VSTS_PAT**: your Personal Access Token

### Install for Your Repositories

In the GitHub settings page for your account (or the organization that you
created the GitHub App in), navigate to the GitHub App settings.  Then just
click install on the app.  Authorize it for all your repositories, or each
repository individually.

Now when you type `/rebuild` on a pull request, it should queue a rebuild.

## License

Copyright (c) Edward Thomson.  All rights reserved.  Available under the
MIT license.

