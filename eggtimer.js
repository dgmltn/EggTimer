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
//             'context1': true|false,
//             'context2': true|false
//         },
//         reviews: {
//             'id1': true|false,
//             'id2': true|false
//         },
//         mergeable: true|false
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
    const url = event.payload.pull_request.url;
    const head_sha = event.payload.pull_request.head.sha;
    const id = event.payload.id;
    const approved = event.payload.review.state.toLowerCase() == "approved";
    const ref = event.payload.pull_request.head.ref;
    console.log(url + " -> pull_request_review");
    ensurePr(url, head_sha);
    prs[url].reviews[id] = approved;
    prs[url].ref = ref;
    populateMergeable(url);
    populateReviews(url);
    mergeIfReady(url);
});

HANDLER.on('pull_request', function(event) {
    const url = event.payload.pull_request.url;
    const head_sha = event.payload.pull_request.head.sha;
    const ref = event.payload.pull_request.head.ref;
    console.log(url + " -> pull_request");
    ensurePr(url, head_sha);
    prs[url].ref = ref;
    populateMergeable(url);
    populateReviews(url);
    mergeIfReady(url);
});

HANDLER.on('status', function(event) {
    const sha = event.payload.sha;
    const context = event.payload.context;
    const state = event.payload.state;
    if (sha in commits) {
        const url = commits[sha];
        console.log(url + " -> status");
        ensurePr(url, sha);
        prs[url].checks[context] = state;
    }
    mergeIfReady(url);
});

///////////////////////////////////////////////////////////////////////////////////////////////////
// Private helpers
///////////////////////////////////////////////////////////////////////////////////////////////////

// Initialize an empty pr
function ensurePr(url, head_sha) {
    if (!(url in prs)) {
        prs[url] = {};
    }
    if (!('head_sha' in prs[url]) || prs[url].head_sha != head_sha) {
        prs[url].head_sha = head_sha;
        prs[url].checks = {};
        prs[url].reviews = {};
        prs[url].mergeable = false;
    }
    commits[head_sha] = url;
}

// GET pull requests and check their mergeable status
function populateMergeable(url) {
    setTimeout(function() {
        const params = parsePullRequestUrl(url);
        GITHUB.pullRequests.get(params,
            function(err, pr) {
                prs[url].mergeable = !!pr.data.mergeable;
                mergeIfReady(url);
            }
        )
    }, 10000);
}

// GET pr reviews and check their approved status
function populateReviews(url) {
    const params = parsePullRequestUrl(url);
    GITHUB.pullRequests.getReviews(params,
        function(err, res) {
            for (i in res.data) {
                const review = res.data[i];
                const id = review.id;
                const approved = review.state.toLowerCase() == "approved";
                prs[url].reviews[id] = approved;
            }

            mergeIfReady(url);
        }
    );
}

// Perform a merge on this PR if:
// 1. it's mergeable
// 2. >1 reviews exist and all are approved
// 3. >1 checks exist and all passed
function mergeIfReady(url) {
    console.log(JSON.stringify(prs, null, 4));
    if (url in prs 
        && !prs[url].done
        && isMergeable(prs[url])
        && isApproved(prs[url])
        && checksPassed(prs[url])) {

        // APPROVED!
        prs[url].done = true;
        console.log("APPROVED!");

        const deleteCallback = function(err, res) {
            if (err) {
                console.log("Error: could not delete ref: " + err);
                return;
            }
            console.log("DELETED!");
        };

        const mergeCallback = function(err, res) {
            if (err) {
                console.log("Error: could not merge: " + err);
                delete prs[url].done;
                return;
            }
            console.log("MERGED!");

            if (CONFIG.delete_after_merge) {
                deleteReference(url, deleteCallback);
            }
        };

        mergePullRequest(url, mergeCallback);
    }
}

function mergePullRequest(url, callback) {
    const params = parsePullRequestUrl(url);
    params.sha = prs[url].head_sha;
    GITHUB.authenticate(GITHUB_AUTHENTICATION);
    GITHUB.pullRequests.merge(params, callback);
}

function deleteReference(url, callback) {
    const params = parsePullRequestUrl(url);
    params.ref = 'heads/' + prs[url].ref;
    GITHUB.authenticate(GITHUB_AUTHENTICATION);
    GITHUB.gitdata.deleteReference(params, callback);
}

function parsePullRequestUrl(url) {
    const re = /^https?:\/\/([^\/]+)\/repos\/([^\/]+)\/([^\/]+)\/pulls\/(\d+)$/;
    const match = re.exec(url);
    return {
        owner: match[2],
        repo: match[3],
        number: match[4]
    };
}

function isMergeable(obj) {
    return 'mergeable' in obj && !!obj.mergeable;
}

function isApproved(obj) {
    if (!('reviews' in obj)) {
        return false;
    }
    else if (Object.keys(obj.reviews).length <= 0) {
        return false;
    }
    for (var id in obj.reviews) {
        if (!obj.reviews[id]) {
            return false;
        }
    }
    return true;
}

function checksPassed(obj) {
    if (!('checks' in obj)) {
        return false;
    }
    else if (Object.keys(obj.checks).length <= 0) {
        return false;
    }
    for (var context in obj.checks) {
        if (!obj.checks[context]) {
            return false;
        }
    }
    return true;
}
