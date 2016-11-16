EggTimer
========

A GitHub webhook target that merges Pull Requests when they're ready.

![](https://i.stack.imgur.com/RgWvA.png)

Description
===========

EggTimer runs as a node script, listening to events (webhooks) from your GitHub repositories. It monitors pull requests, pull request reviews, and changes in status. When the pull request is reviews and approved, and 1 or more tests (checks) have been run, and the pull request is mergeable, then boom!, it's merged! Optionally the branch can be deleted at the same time.

This eliminates one of the headaches of a reviewer: the minutes and hours spent waiting for tests to finish after code has been reviewed, to merge in the finished branch.

It's my solution to my own [StackOverflow Question](http://stackoverflow.com/questions/40391344/automatically-merge-verified-and-tested-github-pull-requests/40398678#40398678)

Configuration
=============

EggTimer is meant to be run as a web server, which is then called
by [GitHub's webhook framework](https://developer.github.com/webhooks/).

Customize config.js
-------------------

Create a config.js, by cloning config-example.js:

```
cp config-example.js config.js
```

Then modify the fields to suit your needs. All fields are required. Here is an
explanation of the fields:

| *Field*                 | *Description*                                                                                                                                                       |
|-------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| *github_username*       | The GitHub username as which this script will be masquerading.                                                                                                      |
| *github_token*          | An auth token generated for the associated *github_username*, (see [documentation](https://help.github.com/articles/creating-an-access-token-for-command-line-use/)). The token needs to have access to repo for writing a comment and merging/deleting branches. |
| *github_webhook_path*   | Path to which the EggTimer webserver should respond, (this needs to be mirrored on the GitHub webhook configuration).                                               |
| *github_webhook_secret* | Generate a random secret string and use this here and, in the GitHub webhook configuration.                                                                         |
| *delete_after_merge*    | boolean - Whether a merged commit should be deleted after merge.                                                                                                    |
| *port*                  | Port of this webserver.                                                                                                                                             |


Start webserver
---------------

This needs to be a publicly accessible server (or accessible from GitHub's webhooks). Either
run it directly:

```
node eggtimer.js
```

Or use a process manager (like [pm2](http://pm2.keymetrics.io/)) to keep it going.

```
pm2 start eggtimer.js
```

Hook GitHub
-----------

Go to your GitHub project's Settings-&gt;Webhooks and "add webhook". The correct "payload URL"
will contain your webserver's hostname, *port*, and *github_webhook_path* configuration. "Content
type" should be `application/json` and "secret" should match your *github_webhook_secret* configuration.

The proper webhook events needed are `Pull request` and `Pull request review` and `Status`.
