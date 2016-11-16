const fs = require('fs');
const http = require('http');
const githubWebhookHandler = require('github-webhook-handler');
const nodeGithub = require('github');

///////////////////////////////////////////////////////////////////////////////////////////////////
// Setup
///////////////////////////////////////////////////////////////////////////////////////////////////

const CONFIG = JSON.parse(fs.readFileSync('config.js'));
const HANDLER = githubWebhookHandler({ path: CONFIG.github_webhook_path, secret: CONFIG.github_webhook_secret });
const GITHUB = new nodeGithub({ version: "3.0.0" });
const GITHUB_AUTHENTICATION = { type: 'token', username: CONFIG.github_username, token: CONFIG.github_token };

///////////////////////////////////////////////////////////////////////////////////////////////////
// PR state representation
///////////////////////////////////////////////////////////////////////////////////////////////////

// PRs contains status about incomplete pr's:
// {
//     'https://api.github.com/repos/dgmltn/api-test/pulls/5': {
//         head_sha: 'abcd1234...',
//         ref: 'my-pull-request',
//         checks: {
//             'context1': {
//             },
//             'context2': {
//             },
//         }
//         review_state: 'pending|success|...',
//         mergeable: true|false,
//     }
// }
var prs = {};

// commits references a pr url to a commit sha:
// {
//     'abcd1234...': 'https://github.com/dgmltn/api-test/pull/5',
// }
var commits = {};

///////////////////////////////////////////////////////////////////////////////////////////////////
// Webhook Handlers
///////////////////////////////////////////////////////////////////////////////////////////////////

http.createServer(function (req, res) {
  HANDLER(req, res, function (err) {
    res.statusCode = 404
    res.end('no such location')
  });
}).listen(CONFIG.port);

HANDLER.on('error', function (err) {
  console.error('Error:', err.message);
});

HANDLER.on('pull_request_review', function(event) {
    var url = event.payload.pull_request.url;
    var head_sha = event.payload.pull_request.head.sha;
    var review_state = event.payload.review.state;
    var ref = event.payload.pull_request.head.ref;
    console.log(url + " -> pull_request_review");
    ensurePr(url, head_sha);
    prs[url].review_state = review_state;
    prs[url].ref = ref;
    populateMergeable(url);
    mergeIfReady(url);
});

HANDLER.on('pull_request', function(event) {
    var url = event.payload.pull_request.url;
    var head_sha = event.payload.pull_request.head.sha;
    var ref = event.payload.pull_request.head.ref;
    console.log(url + " -> pull_request");
    ensurePr(url, head_sha);
    prs[url].ref = ref;
    populateMergeable(url);
    mergeIfReady(url);
});

HANDLER.on('status', function(event) {
    var sha = event.payload.sha;
    var context = event.payload.context;
    var state = event.payload.state;
    if (sha in commits) {
        var url = commits[sha];
        console.log(url + " -> status");
        ensurePr(url, sha);
        prs[url].checks[context] = state;
        mergeIfReady(url);
    }
});

///////////////////////////////////////////////////////////////////////////////////////////////////
// Private helpers
///////////////////////////////////////////////////////////////////////////////////////////////////

function ensurePr(url, head_sha) {
    if (!(url in prs)) {
        prs[url] = {};
    }
    if (!('head_sha' in prs[url]) || prs[url].head_sha != head_sha) {
        prs[url].head_sha = head_sha;
        prs[url].checks = {};
    }
    commits[head_sha] = url;
}

function populateMergeable(url) {
    var params = parsePullRequestUrl(url);
    GITHUB.pullRequests.get(params,
        function(err, res) {
            prs[url].mergeable = res.mergeable;
            mergeIfReady(url);
        }
    );
}

function mergeIfReady(url) {
    console.log(JSON.stringify(prs, null, 4));
    if (url in prs 
        && !prs[url].done
        && isApproved(prs[url])
        && isMergeable(prs[url])
        && checksPassed(prs[url])) {

        // APPROVED!
        prs[url].done = true;
        console.log("APPROVED!");

        mergePullRequest(url, 
            function(err, res) {
                if (err) {
                    console.log("Error: could not merge: " + err);
                    delete prs[url].done;
                    return;
                }
                console.log("MERGED!");

                if (CONFIG.delete_after_merge) {
                    deleteReference(url,
                        function(err, res) {
                            if (err) {
                                console.log("Error: could not delete ref: " + err);
                                return;
                            }
                            console.log("DELETED!");
                        }
                    );
                }
            }
        );
    }
}

function mergePullRequest(url, callback) {
    var params = parsePullRequestUrl(url);
    params.sha = prs[url].head_sha;
    GITHUB.authenticate(GITHUB_AUTHENTICATION);
    GITHUB.pullRequests.merge(params, callback);
}

function deleteReference(url, callback) {
    var params = parsePullRequestUrl(url);
    params.ref = 'heads/' + prs[url].ref;
    GITHUB.authenticate(GITHUB_AUTHENTICATION);
    GITHUB.gitdata.deleteReference(params, callback);
}

function parsePullRequestUrl(url) {
    const re = /^https?:\/\/([^\/]+)\/repos\/([^\/]+)\/([^\/]+)\/pulls\/(\d+)$/;
    var match = re.exec(url);
    return {
        owner: match[2],
        repo: match[3],
        number: match[4]
    };
}

function isApproved(obj) {
    return 'review_state' in obj && obj.review_state == 'approved';
}

function isMergeable(obj) {
    return 'mergeable' in obj && obj.mergeable == true
}

function checksPassed(obj) {
    if (!('checks' in obj)) {
        return false;
    }
    else if (Object.keys(obj.checks).length <= 0) {
        return false;
    }
    for (var context in obj.checks) {
        if (obj.checks[context] != 'success') {
            return false;
        }
    }
    return true;
}
