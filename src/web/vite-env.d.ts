/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_AZURE_CLIENT_ID?: string;
  readonly VITE_AZURE_TENANT_ID?: string;
  /**
   * Scope exposto pela API no Entra ID, no formato
   * api://<client-id>/access_as_user. Quando definido, o frontend manda o
   * access token desse scope em vez do id token. Ver src/web/lib/msal.ts.
   */
  readonly VITE_AZURE_API_SCOPE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
