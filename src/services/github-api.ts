const API_ROOT = 'https://api.github.com';

export interface GitHubRepository {
  owner: string;
  name: string;
  private: boolean;
  htmlUrl: string;
}

export interface GitHubFile {
  sha: string;
  text: string;
  size: number;
}

export class GitHubApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export class GitHubApi {
  constructor(
    private readonly token: string,
    private readonly request: typeof fetch = fetch
  ) {}

  async authenticatedLogin(): Promise<string> {
    const data = await this.json('GET', '/user');
    const login = stringField(data, 'login');
    if (!login) throw new GitHubApiError('GitHub 返回的账号信息无效');
    return login;
  }

  async getRepository(owner: string, name: string): Promise<GitHubRepository | undefined> {
    const response = await this.call('GET', `/repos/${segment(owner)}/${segment(name)}`, undefined, true);
    if (response.status === 404) return undefined;
    return parseRepository(await responseJson(response));
  }

  async createPrivateRepository(name: string): Promise<GitHubRepository> {
    const data = await this.json('POST', '/user/repos', {
      name,
      private: true,
      auto_init: false,
      description: 'A股盯盘自选股私有同步仓库'
    });
    return parseRepository(data);
  }

  async getFile(owner: string, repository: string, filePath: string, maxBytes: number): Promise<GitHubFile | undefined> {
    const response = await this.call('GET', `/repos/${segment(owner)}/${segment(repository)}/contents/${pathSegments(filePath)}`, undefined, true);
    if (response.status === 404) return undefined;
    const data = await responseJson(response);
    const sha = stringField(data, 'sha');
    const content = stringField(data, 'content');
    const encoding = stringField(data, 'encoding');
    const size = numberField(data, 'size');
    if (!sha || content === undefined || encoding !== 'base64' || size === undefined) throw new GitHubApiError('GitHub 云端备份响应格式无效');
    if (size > maxBytes) throw new GitHubApiError(`GitHub 云端备份超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB`);
    let text: string;
    try { text = Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf8'); } catch { throw new GitHubApiError('GitHub 云端备份无法解码'); }
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new GitHubApiError(`GitHub 云端备份超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB`);
    return { sha, text, size };
  }

  async putFile(owner: string, repository: string, filePath: string, text: string, sha?: string): Promise<{ sha: string }> {
    const data = await this.json('PUT', `/repos/${segment(owner)}/${segment(repository)}/contents/${pathSegments(filePath)}`, {
      message: `sync watchlist ${new Date().toISOString()}`,
      content: Buffer.from(text, 'utf8').toString('base64'),
      ...(sha ? { sha } : {})
    });
    const root = record(data);
    const content = record(root?.content);
    const nextSha = stringField(content, 'sha');
    if (!nextSha) throw new GitHubApiError('GitHub 上传成功，但返回的文件版本无效');
    return { sha: nextSha };
  }

  private async json(method: string, path: string, body?: unknown): Promise<unknown> {
    return responseJson(await this.call(method, path, body));
  }

  private async call(method: string, path: string, body?: unknown, allowNotFound = false): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(`${API_ROOT}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'a-stock-watch-vscode',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch (error) {
      throw new GitHubApiError(`无法连接 GitHub：${errorMessage(error)}`);
    }
    if (response.ok || (allowNotFound && response.status === 404)) return response;
    const detail = await githubErrorDetail(response);
    if (response.status === 401) throw new GitHubApiError('GitHub 登录已失效，请重新登录', response.status);
    if (response.status === 403) throw new GitHubApiError(`GitHub 权限不足或请求受限${detail ? `：${detail}` : ''}`, response.status);
    if (response.status === 409 || response.status === 422) throw new GitHubApiError(`GitHub 数据发生冲突${detail ? `：${detail}` : ''}`, response.status);
    throw new GitHubApiError(`GitHub 请求失败（${response.status}）${detail ? `：${detail}` : ''}`, response.status);
  }
}

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new GitHubApiError('GitHub 返回了无法解析的数据', response.status); }
}

async function githubErrorDetail(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return stringField(data, 'message') ?? '';
  } catch {
    return '';
  }
}

function parseRepository(value: unknown): GitHubRepository {
  const data = record(value);
  const owner = record(data?.owner);
  const login = stringField(owner, 'login');
  const name = stringField(data, 'name');
  const isPrivate = data?.private;
  const htmlUrl = stringField(data, 'html_url');
  if (!login || !name || typeof isPrivate !== 'boolean' || !htmlUrl) throw new GitHubApiError('GitHub 返回的仓库信息无效');
  return { owner: login, name, private: isPrivate, htmlUrl };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const item = record(value)?.[key];
  return typeof item === 'string' ? item : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  const item = record(value)?.[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function pathSegments(value: string): string {
  return value.split('/').map(segment).join('/');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
