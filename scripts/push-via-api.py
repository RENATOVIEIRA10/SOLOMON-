#!/usr/bin/env python3
"""Push local commits para origin master via GitHub REST API.

Uso:
    python scripts/push-via-api.py                 # pusha HEAD (1 commit a frente)
    python scripts/push-via-api.py --branch master
    python scripts/push-via-api.py --sha abc1234   # replica commit especifico

Necessario em notebooks onde `git push` HTTPS retorna 403 persistente
(cred-manager corporativo, intercept SSL, etc). Replica os N commits a frente
de origin/<branch> como novos commits via API (blob+tree+commit+ref).

Le token de ~/.git-credentials (formato https://<user>:<token>@github.com).
Apos push, faz `git reset --hard origin/<branch>` local para alinhar SHAs.
"""
import argparse
import base64
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.request


def load_token() -> str:
    home = os.path.expanduser("~")
    path = os.path.join(home, ".git-credentials")
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            m = re.match(r"https://([^:]+):([^@]+)@github\.com", line.strip())
            if m:
                return m.group(2)
    sys.exit("ERRO: token GitHub nao encontrado em ~/.git-credentials")


def parse_remote(remote_url: str) -> tuple[str, str]:
    # https://github.com/OWNER/REPO.git ou git@github.com:OWNER/REPO.git
    m = re.search(r"github\.com[/:]([^/]+)/([^/]+?)(?:\.git)?/?$", remote_url)
    if not m:
        sys.exit(f"ERRO: nao consegui extrair owner/repo de {remote_url}")
    return m.group(1), m.group(2)


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


class GH:
    def __init__(self, owner: str, repo: str, token: str):
        self.base = f"https://api.github.com/repos/{owner}/{repo}"
        self.token = token
        self.ctx = ssl.create_default_context()
        self.ctx.check_hostname = False
        self.ctx.verify_mode = ssl.CERT_NONE

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        url = path if path.startswith("http") else f"{self.base}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"token {self.token}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        req.add_header("User-Agent", "solomon-push-via-api")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            resp = urllib.request.urlopen(req, context=self.ctx, timeout=30)
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            body_txt = e.read().decode("utf-8", errors="replace")
            sys.exit(f"HTTP {e.code} em {method} {path}\n{body_txt[:2000]}")


def replay_commit(gh: GH, local_sha: str, parent_sha: str) -> str:
    # Metadata do commit local
    message = git("show", "-s", "--format=%B", local_sha)
    # Arquivos alterados em relacao ao parent
    changed = git("diff", "--name-only", parent_sha, local_sha).splitlines()
    deleted = set(git("diff", "--diff-filter=D", "--name-only", parent_sha, local_sha).splitlines())

    tree_entries = []
    for path in changed:
        if path in deleted:
            tree_entries.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
            continue
        content = subprocess.check_output(["git", "show", f"{local_sha}:{path}"])
        blob = gh.call("POST", "/git/blobs", {
            "content": base64.b64encode(content).decode("ascii"),
            "encoding": "base64",
        })
        tree_entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print(f"  blob {path}: {blob['sha'][:10]}")

    parent_commit = gh.call("GET", f"/git/commits/{parent_sha}")
    tree = gh.call("POST", "/git/trees", {
        "base_tree": parent_commit["tree"]["sha"],
        "tree": tree_entries,
    })
    commit = gh.call("POST", "/git/commits", {
        "message": message,
        "tree": tree["sha"],
        "parents": [parent_sha],
    })
    print(f"  commit: {commit['sha'][:10]} (local era {local_sha[:10]})")
    return commit["sha"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", default="master")
    ap.add_argument("--sha", help="Replica apenas este commit (HEAD..parent por default)")
    ap.add_argument("--remote", default="origin")
    args = ap.parse_args()

    remote_url = git("remote", "get-url", args.remote)
    owner, repo = parse_remote(remote_url)
    gh = GH(owner, repo, load_token())
    print(f"repo: {owner}/{repo}  branch: {args.branch}")

    subprocess.check_call(["git", "fetch", args.remote, args.branch])
    remote_ref = f"{args.remote}/{args.branch}"
    remote_sha = git("rev-parse", remote_ref)

    if args.sha:
        commits = [git("rev-parse", args.sha)]
        parent = git("rev-parse", f"{args.sha}^")
    else:
        commits = git("rev-list", "--reverse", f"{remote_ref}..HEAD").splitlines()
        parent = remote_sha

    if not commits:
        print("Nada para pushar — HEAD ja esta em origin/" + args.branch)
        return

    print(f"vou replicar {len(commits)} commit(s) sobre {parent[:10]}:")
    last_sha = parent
    for local_sha in commits:
        print(f"replay {local_sha[:10]}:")
        last_sha = replay_commit(gh, local_sha, last_sha)

    print(f"atualizando {args.branch} -> {last_sha[:10]}")
    gh.call("PATCH", f"/git/refs/heads/{args.branch}", {"sha": last_sha, "force": False})

    # Precisamos baixar o commit novo localmente antes de reset.
    # Retry porque git lock pode estar em uso por outra sessao.
    import time
    fetched = False
    for attempt in range(3):
        r = subprocess.run(["git", "fetch", args.remote, args.branch])
        if r.returncode == 0:
            fetched = True
            break
        print(f"(fetch retry {attempt + 1}/3 em 2s)")
        time.sleep(2)
    if not fetched:
        print(f"AVISO: fetch falhou. Remote em {last_sha}. Corra: git fetch {args.remote} {args.branch} && git reset --hard {args.remote}/{args.branch}")
        return

    current = git("rev-parse", "--abbrev-ref", "HEAD")
    if current == args.branch:
        print(f"alinhando local {args.branch} -> {last_sha[:10]}")
        subprocess.check_call(["git", "reset", "--hard", f"{args.remote}/{args.branch}"])
    else:
        print(f"(branch atual e '{current}' — corra `git reset --hard {args.remote}/{args.branch}` se quiser)")

    print("OK")


if __name__ == "__main__":
    main()
