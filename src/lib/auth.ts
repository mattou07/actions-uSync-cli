/**
 * Obtains an OAuth2 bearer token from the Umbraco back-office token endpoint
 * using the client credentials grant.
 *
 * Reference: uSync.Commands.Core/Http/HttpClientExtensions.cs GetAccessToken()
 */
export async function getAccessToken(
  server: string,
  clientId: string,
  secret: string
): Promise<string> {
  const base = server.replace(/\/+$/, '')
  const url = `${base}/umbraco/management/api/v1/security/back-office/token`

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: secret
  }).toString()

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })

  if (!response.ok) {
    throw new Error(
      `Failed to obtain access token: ${response.status} ${response.statusText}`
    )
  }

  const data = (await response.json()) as { access_token: string }
  return data.access_token
}
