# MedMetric — Next.js on Vercel

This replaces the Google Apps Script runtime with Next.js App Router, React, Chart.js and authenticated server routes. The real `/` page is defined in `app/page.jsx`; Vercel runs the app as a Next.js project.

## Publish the conversion

Extract this entire ZIP into a folder, then double-click **Commit-and-Push.cmd**. It lists changes, commits and pushes the approved Next.js source files to `https://github.com/AslamGeek/medmetric.git`, and closes after three seconds. GitHub authentication may appear on first use; errors remain in `MedMetric-publish.log`. It never uploads `.env` values, sheet snapshots, dependencies or build output. Previous Apps Script files may remain in the repository; Next.js does not execute them.

In Vercel, use the repository root as **Root Directory**, choose **Next.js** as the framework, and clear any old static-site Output Directory override. The supplied `vercel.json` specifies `.next`. Deploy the new commit. The page will load even before Google access is configured; it will show a connection setup notice.

## The one required Google setting

This uses Google's browser token model. Only a **Google OAuth web client ID** is needed, not a client secret or service-account key.

1. In [Google Cloud Console](https://console.cloud.google.com/), select/create your project and enable **Google Sheets API**.
2. Configure the app in **Google Auth Platform** (branding, audience and data access). Request the read-only scope `https://www.googleapis.com/auth/spreadsheets.readonly`. If the app is in Testing mode, add your own Google account under test users. Workspace policy may limit available audience choices.
3. Under **Clients**, create an OAuth client with application type **Web application**. Add this exact **Authorized JavaScript origin**: `https://medmetric-lovat.vercel.app`. Do not add a trailing slash or a path. Popup token mode does not need a redirect URI.
4. Copy the client ID ending in `.apps.googleusercontent.com`. In the Vercel project's **Settings → Environment Variables**, add `GOOGLE_CLIENT_ID` with that value for Production. Redeploy after saving the variable.
5. Open the site and select **Connect with Google**, using an account that already has access to the source sheet. Grant read-only Sheets access. If you later use another domain, add that origin in the Google client configuration too.

Google can require verification for broadly distributed external apps using sensitive scopes. For personal testing, use your listed test account. The app does not modify the source sheet or its sharing.

## Security and data behavior

The access token stays in browser memory and is sent over HTTPS in the Authorization header to same-origin Next.js APIs. It is never placed in a URL, localStorage, a cookie, the repository, or a shared server data cache. Google checks the user's existing sheet access on every batch read. Refreshing the browser, disconnecting, or token expiry requires reconnecting. Disconnect clears the local view; it does not revoke the Google consent grant.

Only the configured spreadsheet and three fixed ranges are read. All sheet requests use Google's read-only Sheets API. API responses use `private, no-store` and never contain tokens. No unauthenticated sheet-data endpoint or anonymous fallback exists. A signed-in user with no sheet access cannot see sales data.

Primary sales remain `Purchase_Value`; secondary remain `Sale_Value`. Product `Sale` remains units and `Value` remains closing inventory. Aliases normalize through `PRODUCT_CONFIG` by exact name and SKU. Financial filters stay separate from product filters. Multi-month flow metrics sum across months, while closing stock uses only the end month. Growth requires comparable complete statements and a positive previous value. Stock age remains an individual observation. Missing metrics are not silently changed to zero.

Chart.js is bundled locally through npm, removing the former runtime CDN dependency. Google Identity Services remains an external sign-in dependency. The dashboard has accessible value tables, configurable candidate thresholds, source-row drill-down and a future question placeholder. `ChartPanel` is the shared component for extending charts; `lib/analytics.js` owns the calculations.

## Local commands

Node.js 22 or newer:

```sh
npm ci
npm test
npm run check
npm run build
npm start
```

For local Google sign-in, set `GOOGLE_CLIENT_ID` in `.env.local` and add `http://localhost:3000` as another authorized JavaScript origin. `npm run dev` starts the development server. Real data is never needed to build the app.

Validation: 18 server/API tests use synthetic fixtures, covering authentication, invalid requests, private responses, Google error handling, batch reads, calculations, mapping, inventory snapshots and pagination. A production build was checked locally. Browser checks were skipped as requested; live Google authorization requires your OAuth client configuration.

References: [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [OAuth web client setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers).
