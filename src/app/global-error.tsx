'use client';

/**
 * Last-resort boundary: it replaces the root layout, so it cannot use the
 * theme tokens, translations or fonts that live there. Deliberately plain.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'grid',
          placeItems: 'center',
          minHeight: '100dvh',
          margin: 0,
          background: '#0d0f14',
          color: '#e9eaee',
        }}
      >
        <main style={{ textAlign: 'center', padding: '2rem' }}>
          <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Sinemai AI</h1>
          <p style={{ color: '#969cac', marginTop: '1rem' }}>
            Something went wrong while loading the application.
          </p>
          {error.digest && (
            <p style={{ color: '#6d7385', fontSize: '0.8rem' }}>Reference: {error.digest}</p>
          )}
          {/* A plain reload, not a router link: this boundary replaces the
              root layout, so the router may be the thing that failed. */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1.5rem',
              padding: '0.6rem 1.2rem',
              borderRadius: '0.6rem',
              border: '1px solid #2a3040',
              background: '#d4a94f',
              color: '#0d0f14',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
