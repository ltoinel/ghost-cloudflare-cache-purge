// HTTP Status Codes
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_ERROR = 500;

// Error Messages
const ERROR_METHOD_NOT_ALLOWED = 'Method not allowed. Only POST requests are accepted.';
const ERROR_INVALID_CONTENT_TYPE = 'Invalid content type. Only application/json is accepted.';
const ERROR_MISSING_ZONE_ID = 'Missing zone ID in URL path.';
const ERROR_MISSING_ACTION = 'Missing action in URL path.';
const ERROR_INVALID_ACTION = 'Invalid action. Allowed actions: postPublished, postUpdated.';
const ERROR_MISSING_API_TOKEN = 'Missing Cloudflare API token in environment.';
const ERROR_INVALID_WEBHOOK = 'Invalid webhook payload structure.';
const ERROR_INVALID_ZONE_FORMAT = 'Invalid zone ID format.';

// Valid actions
const ACTION_POST_PUBLISHED = 'postPublished';
const ACTION_POST_UPDATED = 'postUpdated';
const VALID_ACTIONS = [ACTION_POST_PUBLISHED, ACTION_POST_UPDATED];

export default {
  async fetch(request, env) {
    return handleRequest(request, env)
  },
};

/**
 * Validate HTTP request method and content type.
 * 
 * @param {Request} request The HTTP request object
 * @returns {Response|null} Error response or null if valid
 */
function validateRequest(request) {
  if (request.method !== "POST") {
    return new Response(ERROR_METHOD_NOT_ALLOWED, { status: HTTP_METHOD_NOT_ALLOWED })
  }

  const contentType = request.headers.get("content-type") || ""
  if (!contentType.includes("application/json")) {
    return new Response(ERROR_INVALID_CONTENT_TYPE, { status: HTTP_BAD_REQUEST })
  }

  return null
}

/**
 * Extract and validate zone ID from URL path.
 * 
 * @param {string} zoneID The zone ID to validate
 * @returns {Response|null} Error response or null if valid
 */
function validateZoneID(zoneID) {
  if (!zoneID) {
    return new Response(ERROR_MISSING_ZONE_ID, { status: HTTP_BAD_REQUEST })
  }

  if (!/^[a-f0-9]{32}$/i.test(zoneID)) {
    return new Response(ERROR_INVALID_ZONE_FORMAT, { status: HTTP_BAD_REQUEST })
  }

  return null
}

/**
 * Validate action parameter.
 * 
 * @param {string} action The action to validate
 * @returns {Response|null} Error response or null if valid
 */
function validateAction(action) {
  if (!action) {
    return new Response(ERROR_MISSING_ACTION, { status: HTTP_BAD_REQUEST })
  }

  if (!VALID_ACTIONS.includes(action)) {
    return new Response(ERROR_INVALID_ACTION, { status: HTTP_BAD_REQUEST })
  }

  return null
}

/**
 * Validate API token from environment.
 * 
 * @param {string} apiToken The API token to validate
 * @returns {Response|null} Error response or null if valid
 */
function validateApiToken(apiToken) {
  if (!apiToken) {
    console.error('Missing CF_API_TOKEN in environment variables')
    return new Response(ERROR_MISSING_API_TOKEN, { status: HTTP_INTERNAL_ERROR })
  }

  return null
}

/**
 * Validate webhook body structure.
 * 
 * @param {Object} body The webhook body to validate
 * @returns {Response|null} Error response or null if valid
 */
function validateWebhookBody(body) {
  if (!body?.post?.current?.url) {
    console.error('Invalid webhook payload: missing post.current.url')
    return new Response(ERROR_INVALID_WEBHOOK, { status: HTTP_BAD_REQUEST })
  }

  return null
}

/**
 * Determine which URLs to purge based on the action.
 * 
 * @param {string} action The webhook action
 * @param {string} rootURL The root URL of the site
 * @param {string} postURL The post URL
 * @returns {Array<string>} List of URLs to purge
 */
function getUrlsToPurge(action, rootURL, postURL) {

  // Common URLs to purge
  const urls = [
    `${rootURL}/sitemap.xml`,
    `${rootURL}/sitemap-posts.xml`, 
    `${rootURL}/sitemap-pages.xml`, 
    `${rootURL}/sitemap-tags.xml`, 
    `${rootURL}/sitemap-news/`,  // Ghost Custom News sitemap index
    `${rootURL}/rss/`
  ]

  if (action === ACTION_POST_PUBLISHED) {
    
    // Only purge the homepage for new posts
    urls.push(rootURL)

  } else if (action === ACTION_POST_UPDATED) {

    // Purge the post URL for updated posts
    urls.push(postURL)
  } 

  return urls
}

/**
 * Handle cache purge failure.
 * 
 * @param {Response} response The failed response
 * @param {string} zoneID The zone ID
 * @param {Array<string>} urls The URLs that failed to purge
 * @returns {Promise<Response>} Error response
 */
async function handlePurgeFailure(response, zoneID, urls) {
  const errorText = await response.text()
  console.error(
    `🧹 Purge failed: ${response.status} ${response.statusText} - ` +
    `Zone: ${zoneID} - URLs: ${urls.join(', ')} - Error: ${errorText}`
  )
  return new Response(`Cache purge failed: ${response.statusText}`, { status: response.status })
}

/**
 * Handle cache purge success.
 * 
 * @param {string} zoneID The zone ID
 * @param {Array<string>} urls The successfully purged URLs
 * @returns {Response} Success response
 */
function handlePurgeSuccess(zoneID, urls) {
  console.log(`🧹 Successfully purged: Zone: ${zoneID} - URLs: ${urls.join(', ')}`)
  return new Response("OK", { status: HTTP_OK })
}

/**
 * Get a request from Ghost CMS Webhook.
 * 
 * @param {Request} request The HTTP request Object
 * @param {Object} env The environment variables 
 * @returns {Promise<Response>} An HTTP Response
 */
async function handleRequest(request, env) {
  // Validate request
  const requestError = validateRequest(request)
  if (requestError) return requestError

  // Extract path parameters
  const url = new URL(request.url)
  const [zoneID, action] = url.pathname.split("/").filter(Boolean)

  // Validate zone ID
  const zoneError = validateZoneID(zoneID)
  if (zoneError) return zoneError

  // Validate action
  const actionError = validateAction(action)
  if (actionError) return actionError

  // Validate API token
  const tokenError = validateApiToken(env.CF_API_TOKEN)
  if (tokenError) return tokenError

  // Parse webhook body
  let body
  try {
    body = await parseWebhookBody(request)
  } catch (error) {
    console.error('Failed to parse webhook body:', error.message)
    return new Response(ERROR_INVALID_WEBHOOK, { status: HTTP_BAD_REQUEST })
  }

  // Validate webhook structure
  const bodyError = validateWebhookBody(body)
  if (bodyError) return bodyError

  // Extract URLs
  const postURL = new URL(body.post.current.url)
  const rootURL = `${postURL.protocol}//${postURL.host}`

  // Determine URLs to purge
  const urlsToPurge = getUrlsToPurge(action, rootURL, postURL.href)

  // Purge URLs from Cloudflare Cache
  const response = await purgeURL(urlsToPurge, zoneID, env.CF_API_TOKEN)

  // Handle response
  return response.ok 
    ? handlePurgeSuccess(zoneID, urlsToPurge)
    : await handlePurgeFailure(response, zoneID, urlsToPurge)
}

/**
 * Uses the Cloudflare API to purge URLs from the cache globally.
 * 
 * @param {Array<string>} urlToPurge URLs to purge from the cache
 * @param {string} zoneID Cloudflare zone ID
 * @param {string} apiToken Cloudflare API token
 * @returns {Promise<Response>} Response from Cloudflare API
 */
async function purgeURL(urlToPurge, zoneID, apiToken) {
  const requestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiToken}`
    },
    body: JSON.stringify({ files: urlToPurge })
  }

  return await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneID}/purge_cache`, requestInit)
}

/**
 * Parse the webhook request body.
 * 
 * @param {Request} request The HTTP request object
 * @returns {Promise<Object>} The parsed JSON body
 * @throws {Error} If the body is not valid JSON
 */
async function parseWebhookBody(request) {
  return await request.json()
}
