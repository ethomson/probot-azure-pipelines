import { Application, Context, Logger } from 'probot'
import * as vsts from 'vso-node-api';
import { IBuildApi } from 'vso-node-api/BuildApi';
import { Build, BuildDefinition, PullRequestTrigger, BuildReason } from 'vso-node-api/interfaces/BuildInterfaces';
import './buildapi-extensions'
import './github-types'

interface BuildDefinitionsForProject {
  project: string,
  build_definitions: BuildDefinition[]
}

class RebuildCommand {
  probot: Context
  log: Logger
  issue_number: number
  user: User
  repo_fullname: string
  repo_owner: string
  repo_name: string

  constructor(probot: Context) {
    this.probot = probot
    this.log = probot.log
    this.issue_number = probot.payload.issue.number
    this.user = probot.payload.comment.user

    this.repo_fullname = this.probot.payload.repository.full_name
    var repo_name = this.probot.payload.repository.full_name.split("/", 2)
    this.repo_owner = repo_name[0]
    this.repo_name = repo_name[1]
  }

  async loadPullRequest(): Promise<PullRequest|null> {
    this.log.debug('Ensuring that issue ' + this.issue_number + ' is a pull request')

    if (!this.probot.payload.issue.pull_request) {
      this.log.trace('Issue ' + this.issue_number + ' is not a pull request, issue type validation failed')
      return null
    }
      
    this.log.trace('Issue ' + this.issue_number + ' is a pull request')
  
    var pr = await this.probot.github.pullRequests.get({ owner: this.repo_owner, repo: this.repo_name, number: this.issue_number })
  
    if (!pr.data.base) {
      this.log.trace('Pull request ' + this.probot.payload.issue.number + ' has no base branch')
      return null
    }
  
    this.log.debug('Pull request ' + this.probot.payload.issue.number + ' is targeting base branch ' + pr.data.base.ref)
    return pr.data as PullRequest
  }

  async ensureCollaboratorPermissions()
  {
    var response = await this.probot.github.repos.getCollaborators({ owner: this.repo_owner, repo: this.repo_name })
    var allowed = false

    this.log.debug('Ensuring that ' + this.user.login + ' is a collaborator')

    response.data.some((collaborator) => {
      if (collaborator.login == this.user.login) {
        allowed = true
        return true
      }

      return false
    })

    if (allowed) {
      this.log.trace(this.user.login + ' is a collaborator')
      return true
    }

    this.log.trace(this.user.login + ' is not a collaborator, permission validation failed')
    return false
  }

  connectToVSTS(): vsts.WebApi {
    var url = process.env.VSTS_URL
    var auth_handler = vsts.getPersonalAccessTokenHandler(process.env.VSTS_PAT as string)
    return new vsts.WebApi(url as string, auth_handler)
  }

  async connectToBuildService(): Promise<IBuildApi> {
    return await this.connectToVSTS().getBuildApi()
  }

  async loadProjects(vsts_build: IBuildApi)
  {
    if (process.env.VSTS_PROJECTS) {
      return process.env.VSTS_PROJECTS.split(',')
    }

    var coreApi = await this.connectToVSTS().getCoreApi()
    var projects = await coreApi.getProjects()
    var project_names: string[] = [ ]

    projects.forEach((p) => {
      project_names.push(p.name)
    })

    return project_names
  }

  async loadBuildDefinitionsForPullRequest(vsts_build: IBuildApi, projects: string[], pull_request: PullRequest): Promise<BuildDefinitionsForProject[]>
  {
    var build_definitions: BuildDefinitionsForProject[] = [ ]

    for (var project of projects) {
      var pr_definitions: BuildDefinition[] = [ ]

      this.log.debug('Looking for a pull request build definitions for ' + project + ' in ' + process.env.VSTS_URL)

      var all_definitions = await vsts_build.getDefinitions(
        project,
        undefined,
        this.repo_fullname,
        "GitHub",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true)

      all_definitions.forEach((dr) => {
        var definition = dr as BuildDefinition
        var is_pr_definition = false

        this.log.debug('Examining build definition ' + definition.id)

        definition.triggers.some((t) => {
          if (t.triggerType.toString() == 'pullRequest') {
            var trigger = t as PullRequestTrigger

            if (trigger.branchFilters) {
              trigger.branchFilters.some((branch) => {
                if (branch == '+' + pull_request.base.ref) {
                  this.log.trace('Build definition ' + definition.id + ' is a pull request build for ' + pull_request.base.ref)
                  is_pr_definition = true
                  return true
                }

                return false
              })
            }
            
            if (is_pr_definition) {
              return true
            }
          }

          return false
        })

        if (is_pr_definition) {
          this.log.trace('Found build definition ' + definition.id + ' for pull requests')
          pr_definitions.push(definition)
        }
      })

      if (pr_definitions.length > 0) {
        build_definitions.push({
          project: project,
          build_definitions: pr_definitions
        })
      }
    }

    return build_definitions
  }

  async loadBuilds(vsts_build: IBuildApi, definitions_for_projects: BuildDefinitionsForProject[]): Promise<Build[]> {
    var builds: Build[] = [ ]

    for (var definition_for_project of definitions_for_projects) {
      var builds_for_project = await vsts_build.getBuilds(
        definition_for_project.project,
        definition_for_project.build_definitions.map(({id}) => id),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        BuildReason.PullRequest,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        undefined,
        undefined,
        'refs/pull/' + this.issue_number + '/merge',
        undefined,
        this.repo_fullname,
        "GitHub")

      builds = builds.concat(builds_for_project)
    }

    return builds
  }

  async requeueBuilds(vsts_build: IBuildApi, sourceBuilds: Build[]): Promise<Build[]> {
    var queuedBuilds: Build[] = []

    for (var sourceBuild of sourceBuilds) {
      this.log.debug("Requeuing source build ID " + sourceBuild.id + " for " + sourceBuild.project.name)

      var queuedBuild = await vsts_build.requeueBuild(sourceBuild, sourceBuild.id, sourceBuild.project.id)
      queuedBuilds.push(queuedBuild)
    }

    return queuedBuilds
  }

  fail(message: string) {
    this.probot.github.issues.createComment(this.probot.issue({
      body: 'Sorry @' + this.user.login + ', ' + message + '.'
    }))
    return false
  }

  async run(): Promise<void> {
    this.log.debug("Asked by " + this.user.login + " to rebuild pull request " + this.issue_number)

    try {
      var pull_request = await this.loadPullRequest()
      if (!pull_request) {
        this.fail('this is not a pull request')
        return
      }

      if (!await this.ensureCollaboratorPermissions()) {
        this.fail(`you're not allowed to do that`)
        return
      }

      var vsts_build = await this.connectToBuildService()
      if (!vsts_build) {
        this.fail(`I couldn't connect to the build service`)
        return
      }

      var projects = await this.loadProjects(vsts_build)
      if (!projects) {
        this.fail('this project does not have any VSTS projects configured')
      }
      
      var definitions = await this.loadBuildDefinitionsForPullRequest(vsts_build, projects, pull_request)

      if (definitions.length == 0) {
        this.fail('this project does not have any pull request builds configured')
        return
      }

      var failedBuilds = await this.loadBuilds(vsts_build, definitions)

      if (failedBuilds.length == 0) {
        this.fail('I was not able to find any builds to requeue')
        return
      }

      var queuedBuilds = await this.requeueBuilds(vsts_build, failedBuilds)

      if (queuedBuilds.length == 0) {
        this.fail('I was not able to requeue builds')
        return
      }
    }
    catch(e) {
      this.fail('an error occurred while trying to requeue the build')
      this.log.error(e)
      return
    }
  
    this.probot.github.issues.createComment(this.probot.issue({
      body: 'Okay, @' + this.user.login + ', I started to rebuild this pull request.'
    }))

    this.log.info('Rebuilding pull request ' + this.issue_number + ' for ' + this.user.login)
  }
}

if (!process.env.VSTS_URL || !process.env.VSTS_PAT) {
  console.warn('Missing VSTS configuration: set the VSTS_URL and VSTS_PATH variables')
  process.exit(1)
}

export = (app: Application) => {
  app.log('Started')

  app.on(['issue_comment.created'], async (context: Context) => {
    var command = context.payload.comment.body.trim()

    if (command == "/rebuild") {
      context.log.trace("Command received: " + command)

      new RebuildCommand(context).run()
    }
  })
}