#!/usr/bin/env bash

set -euo pipefail

die() {
  echo "github-upload: $*" >&2
  exit 1
}

force_push=0
for arg in "$@"; do
  case "${arg}" in
    --force-with-lease)
      force_push=1
      ;;
    --force)
      force_push=1
      ;;
    *)
      die "usage: $(basename "$0") [--force-with-lease]"
      ;;
  esac
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

find_git() {
  if [[ -n "${GIT_BIN:-}" ]]; then
    echo "${GIT_BIN}"
    return 0
  fi

  if command -v git.exe >/dev/null 2>&1; then
    command -v git.exe
    return 0
  fi

  command -v git
}

find_gh() {
  if [[ -n "${GH_BIN:-}" ]]; then
    echo "${GH_BIN}"
    return 0
  fi

  if command -v gh >/dev/null 2>&1; then
    command -v gh
    return 0
  fi

  if command -v gh.exe >/dev/null 2>&1; then
    command -v gh.exe
    return 0
  fi

  for candidate in \
    "/mnt/c/Users/28219/AppData/Local/Programs/GitHubCLI/bin/gh.exe" \
    "/c/Users/28219/AppData/Local/Programs/GitHubCLI/bin/gh.exe"
  do
    if [[ -x "${candidate}" ]]; then
      echo "${candidate}"
      return 0
    fi
  done

  return 1
}

root_dir="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "${root_dir}" ]] || die "run this from inside the Teamflow git repository"
cd "${root_dir}"

gh_bin="$(find_gh || true)"
[[ -n "${gh_bin}" ]] || die "missing GitHub CLI: install gh or set GH_BIN"
git_bin="$(find_git || true)"
[[ -n "${git_bin}" ]] || die "missing git binary"

if command -v wslpath >/dev/null 2>&1; then
  root_dir_native="$(wslpath -w "${root_dir}")"
else
  root_dir_native="${root_dir}"
fi

if ! "${gh_bin}" auth status >/dev/null 2>&1; then
  die "gh is not authenticated; run gh auth login first"
fi

repo_slug="$("${gh_bin}" repo view --json nameWithOwner --jq '.nameWithOwner')"
repo_visibility="$("${gh_bin}" repo view --json visibility --jq '.visibility')"

if [[ "${repo_visibility}" != "PRIVATE" ]]; then
  echo "github-upload: making ${repo_slug} private"
  "${gh_bin}" repo edit "${repo_slug}" --visibility private >/dev/null
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "${current_branch}" != "HEAD" ]] || die "detached HEAD; checkout a branch before uploading"

github_remote_url="https://github.com/${repo_slug}.git"

if "${git_bin}" -C "${root_dir_native}" remote get-url github >/dev/null 2>&1; then
  "${git_bin}" -C "${root_dir_native}" remote set-url github "${github_remote_url}"
else
  "${git_bin}" -C "${root_dir_native}" remote add github "${github_remote_url}"
fi

echo "github-upload: pushing ${current_branch} to ${repo_slug}"
if [[ "${git_bin}" == *.exe ]]; then
  if [[ "${force_push}" -eq 1 ]]; then
    "${git_bin}" -C "${root_dir_native}" push --force-with-lease github "HEAD:${current_branch}"
  else
    "${git_bin}" -C "${root_dir_native}" push github "HEAD:${current_branch}"
  fi
else
  github_token="$("${gh_bin}" auth token)"
  if [[ "${force_push}" -eq 1 ]]; then
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
    GIT_CONFIG_VALUE_0="AUTHORIZATION: bearer ${github_token}" \
      "${git_bin}" -C "${root_dir_native}" push --force-with-lease github "HEAD:${current_branch}"
  else
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
    GIT_CONFIG_VALUE_0="AUTHORIZATION: bearer ${github_token}" \
      "${git_bin}" -C "${root_dir_native}" push github "HEAD:${current_branch}"
  fi
fi
