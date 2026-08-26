# Cache policy

Caching is split by whether a response is immutable, mutable public content, or private.

| Response                                                   | Browser policy                        | Shared-cache policy                                        |
| ---------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| Hashed build assets and versioned media                    | one year, immutable                   | one year, immutable                                        |
| Mutable public media                                       | one hour, then stale-while-revalidate | same                                                       |
| Root icons and other stable unversioned images             | one day, then stale-while-revalidate  | same                                                       |
| RSS and sitemap XML                                        | revalidate                            | one hour, with bounded stale-on-refresh and stale-on-error |
| Other dynamic documents                                    | revalidate                            | revalidate                                                 |
| API, authenticated, tokenized, or cookie-setting responses | do not store                          | do not store                                               |

The application owns these standard HTTP headers. Provider configuration may make a response
eligible for edge caching, but must not broaden its TTL or override a private response.

## Cloudflare

The public R2 bucket is attached to `pics.milkandhenny.com`; R2 object metadata supplies its cache
policy. Responsive image URLs include a content-derived `v` query parameter, so replacing an object
creates a new browser and edge cache key before the immutable policy is applied.

The main zone has one narrowly scoped Cache Rule named `Cache public discovery documents`:

```text
http.host in {"milkandhenny.com" "www.milkandhenny.com"}
and http.request.method in {"GET" "HEAD"}
and http.request.uri.path in {"/feed.xml" "/sitemap.xml"}
and http.request.uri.query eq ""
```

The rule makes matching responses eligible for cache and uses `bypass_by_default` for edge TTL.
Cloudflare therefore caches only responses that carry the application's explicit cacheable header;
errors without that header and header regressions bypass the edge cache. Query-bearing requests
remain uncached to prevent cache-key fragmentation. Browser TTL continues to respect the origin
header.

Do not add a broad HTML Cache Rule. Public pages share the root attendee shell, and the application
switches any response involving the attendee cookie or `Set-Cookie` to `private, no-store`.
