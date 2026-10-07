// Port af templates/macros/pagination.html (render_pagination).
import { argsToDict, dictMerge, urlFor, type Endpoint, type RequestInfo } from './context'
import { on } from './jinja'

export interface PaginationProps {
  currentPage: number
  totalPages: number
  /** Endpoint for linksene; ellers request.endpoint */
  endpoint?: string | null
  req: RequestInfo
}

export function Pagination({ currentPage, totalPages, endpoint, req }: PaginationProps) {
  if (!(totalPages > 1)) return null
  const target = (endpoint || req.endpoint) as Endpoint
  // _travlt er workerens genindlæsnings-tæller og må ikke med i linksene.
  const pageArgs = argsToDict(req.args).filter(([k]) => k !== '_travlt')
  const viewArgs = Object.entries(req.viewArgs)
  const href = (page: number) => urlFor(target, dictMerge(viewArgs, dictMerge(pageArgs, [['page', page]])))

  const cur = currentPage
  const pageLink = (p: number) =>
    p === cur ? (
      <span key={p} className="page-btn active" aria-current="page">{p}</span>
    ) : (
      <a key={p} href={href(p)} className="page-btn">{p}</a>
    )

  const middle: number[] = []
  if (totalPages > 7) {
    for (let p = Math.max(cur - 1, 2); p < Math.min(cur + 2, totalPages - 1) + 1; p++) middle.push(p)
  }

  return (
    <>
      <div className="pagination">
        {cur > 1 ? (
          <>
            <a href={href(1)} className="page-btn" title="Første side" aria-label="Første side">«</a>
            <a href={href(cur - 1)} className="page-btn" title="Forrige side" aria-label="Forrige side">‹</a>
          </>
        ) : (
          <>
            <span className="page-btn disabled" aria-disabled="true">«</span>
            <span className="page-btn disabled" aria-disabled="true">‹</span>
          </>
        )}

        {totalPages <= 7 ? (
          Array.from({ length: totalPages }, (_, i) => pageLink(i + 1))
        ) : (
          <>
            {cur === 1 ? (
              <span className="page-btn active" aria-current="page">1</span>
            ) : (
              <a href={href(1)} className="page-btn">1</a>
            )}
            {cur > 3 && <span className="page-btn page-ellipsis">…</span>}
            {middle.map(pageLink)}
            {cur < totalPages - 2 && <span className="page-btn page-ellipsis">…</span>}
            {cur === totalPages ? (
              <span className="page-btn active" aria-current="page">{totalPages}</span>
            ) : (
              <a href={href(totalPages)} className="page-btn">{totalPages}</a>
            )}
          </>
        )}

        {cur < totalPages ? (
          <>
            <a href={href(cur + 1)} className="page-btn" title="Næste side" aria-label="Næste side">›</a>
            <a href={href(totalPages)} className="page-btn" title="Sidste side" aria-label="Sidste side">»</a>
          </>
        ) : (
          <>
            <span className="page-btn disabled" aria-disabled="true">›</span>
            <span className="page-btn disabled" aria-disabled="true">»</span>
          </>
        )}
      </div>

      {totalPages > 5 && (
        <div className="pagination-jump">
          <label className="pagination-jump-label">Gå til side</label>
          <input
            type="number"
            className="pagination-jump-input"
            min="1"
            max={String(totalPages)}
            placeholder={String(cur)}
            aria-label="Sidetal"
            {...on({ onkeydown: `if(event.key==='Enter'){paginationJump(this,${totalPages})}` })}
          />
          <button
            className="page-btn pagination-jump-btn"
            {...on({ onclick: `paginationJump(this.previousElementSibling,${totalPages})` })}
          >
            →
          </button>
          <span className="pagination-jump-of">{`af ${totalPages}`}</span>
        </div>
      )}
    </>
  )
}
