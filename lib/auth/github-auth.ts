type GitHubAuthEnv = {
  AUTH_GITHUB_ID?: string;
  AUTH_GITHUB_SECRET?: string;
};

export function getGitHubAuthProvider(env: GitHubAuthEnv = process.env as GitHubAuthEnv) {
  const clientId = env.AUTH_GITHUB_ID?.trim();
  const clientSecret = env.AUTH_GITHUB_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function isGitHubAuthEnabled(env: GitHubAuthEnv = process.env as GitHubAuthEnv) {
  return getGitHubAuthProvider(env) !== null;
}
