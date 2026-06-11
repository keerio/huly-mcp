import { getClient as getRawAccountClient, type AccountClient } from '@hcengineering/account-client'
import { type Client, TxOperations, type PersonId } from '@hcengineering/core'
import { createClient } from '@hcengineering/server-client'

interface ConnectionState {
  txClient: TxOperations
  rawConnection: Client
  accountClient: AccountClient
  wsToken: string
  workspaceUuid: string
}

let state: ConnectionState | null = null
let connectPromise: Promise<ConnectionState> | null = null

export async function getConnection (): Promise<TxOperations> {
  if (state !== null) return state.txClient
  if (connectPromise !== null) return (await connectPromise).txClient
  connectPromise = connect()
  try {
    state = await connectPromise
  } finally {
    // Always clear the cached promise: a rejected connect() must not be
    // cached forever, otherwise every subsequent call replays the same error
    // until the process is restarted.
    connectPromise = null
  }
  return state.txClient
}

export async function getAccountClient (): Promise<AccountClient> {
  if (state !== null) return state.accountClient
  await getConnection()
  return state!.accountClient
}

export async function getWorkspaceInfo (): Promise<{ wsToken: string, workspaceUuid: string }> {
  if (state !== null) return { wsToken: state.wsToken, workspaceUuid: state.workspaceUuid }
  await getConnection()
  return { wsToken: state!.wsToken, workspaceUuid: state!.workspaceUuid }
}

async function connect (): Promise<ConnectionState> {
  const email = process.env.HULY_EMAIL
  const password = process.env.HULY_PASSWORD
  const workspaceUrl = process.env.HULY_WORKSPACE
  const hulyToken = process.env.HULY_TOKEN
  const accountsUrl = process.env.HULY_ACCOUNTS_URL ?? 'https://account.huly.app'

  if (workspaceUrl == null) {
    throw new Error('Missing required env var: HULY_WORKSPACE')
  }

  let socialId: PersonId
  let endpoint: string
  let wsToken: string
  let workspaceUuid: string = ''

  if (hulyToken != null) {
    // Token-based auth — for SSO accounts (Google/GitHub login on huly.app)
    // Get the token from your browser: huly.app → DevTools → Application →
    // Local Storage → huly.app → look for the key "token"
    const authedClient = getRawAccountClient(accountsUrl, hulyToken)
    const info = await authedClient.getLoginInfoByToken()

    if (info == null) {
      throw new Error('HULY_TOKEN is invalid or expired. Please get a fresh token from huly.app DevTools.')
    }

    if ('endpoint' in info && info.endpoint != null) {
      // It's a WorkspaceLoginInfo — already has endpoint + workspace token
      if (info.socialId == null) {
        throw new Error('Token auth: no socialId in token. Try a workspace-scoped token.')
      }
      socialId = info.socialId as PersonId
      endpoint = info.endpoint
      wsToken = info.token!
      workspaceUuid = String(info.workspace ?? '')
    } else if ('token' in info && info.token != null) {
      // It's a plain LoginInfo (account-level token) — still need selectWorkspace
      if (info.socialId == null) {
        throw new Error('Token auth: no socialId returned.')
      }
      socialId = info.socialId as PersonId
      const wsInfo = await authedClient.selectWorkspace(workspaceUrl, 'external')
      if (wsInfo.endpoint == null || wsInfo.token == null) {
        throw new Error(`Workspace '${workspaceUrl}' not found or not accessible.`)
      }
      endpoint = wsInfo.endpoint
      wsToken = wsInfo.token
      workspaceUuid = String(wsInfo.workspace ?? '')
    } else {
      throw new Error('Token auth: unexpected response from getLoginInfoByToken. Token may be incomplete.')
    }
  } else {
    // Email + password auth — for accounts with a password set on huly.app
    if (email == null || password == null) {
      throw new Error(
        'Missing credentials. Provide HULY_TOKEN (for SSO accounts) or both HULY_EMAIL and HULY_PASSWORD.'
      )
    }

    // Step 1: login → get account token + socialId
    const unauthClient = getRawAccountClient(accountsUrl)
    const loginInfo = await unauthClient.login(email, password)

    if (loginInfo.token == null) {
      throw new Error('Login failed: no token returned. Check credentials.')
    }
    if (loginInfo.socialId == null) {
      throw new Error('Login failed: no socialId returned.')
    }

    // Step 2: select workspace → get WS endpoint + workspace token
    const authedAccountClient = getRawAccountClient(accountsUrl, loginInfo.token)
    const wsInfo = await authedAccountClient.selectWorkspace(workspaceUrl, 'external')

    if (wsInfo.endpoint == null || wsInfo.token == null) {
      throw new Error(`Workspace '${workspaceUrl}' not found or not accessible.`)
    }

    socialId = loginInfo.socialId as PersonId
    endpoint = wsInfo.endpoint
    workspaceUuid = String(wsInfo.workspace ?? '')
    wsToken = wsInfo.token
  }

  // Step 3: open WebSocket connection
  const rawConnection = await createClient(endpoint, wsToken)
  const txClient = new TxOperations(rawConnection, socialId)

  // Build workspace-scoped account client for member lookups
  const accountClient = getRawAccountClient(accountsUrl, wsToken)

  return { txClient, rawConnection, accountClient, wsToken, workspaceUuid }
}

export async function closeConnection (): Promise<void> {
  if (state !== null) {
    await state.rawConnection.close()
    state = null
  }
}
