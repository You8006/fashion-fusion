// --- Original handler temporarily disabled for deployment warm-up isolation test ---
// (Retained below commented out for quick restore.)
// ...original complex POST handler code preserved above (see git history for full diff)...

export async function POST() {
  // Minimal always-200 response to test SWA SSR/Functions cold start health.
  return new Response(JSON.stringify({ ok: true, minimal: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Is-Minimal': '1' }
  });
}
