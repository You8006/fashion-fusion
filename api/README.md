# Placeholder for Azure Static Web Apps Functions

This folder will host Azure Functions (e.g. /api/generate) later to proxy Gemini API calls securely.

For now, the app calls Gemini directly from the browser using NEXT_PUBLIC_GEMINI_API_KEY.

Next step idea:

- Create `api/generate/index.ts` (JavaScript) function
- Move API key to environment (SWA backend) and call Gemini server-side
- Validate and size-limit images, enforce rate limiting
