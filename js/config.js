/* Potafo Accounts - Supabase settings.
   Fill these two values to switch on cloud sync (see the setup steps).
   Leave them empty and the app keeps working, saving only in this browser.

   Use the "anon" / "publishable" key. NEVER put the "service_role" / "secret" key here.

   gmailClientId (optional): a Google "OAuth client ID" (looks like 1234-abc.apps.googleusercontent.com). With it, Send in a
   saved report creates the Gmail draft WITH the Excel attached. Leave it empty and Send opens a Gmail message you attach to
   yourself. It is not a secret. It works only when the app is opened from an http(s) address, not from a file on disk. */
window.POTAFO_CONFIG = {
  gmailClientId: '',
  supabaseUrl: 'https://dlhewonqvoqugbrvexab.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsaGV3b25xdm9xdWdicnZleGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NjM4MTEsImV4cCI6MjEwNjIzOTgxMX0.-tFhRHr-T95tTUSo3Sa5PIw8gNHxE8170a1XRtd0R_c'
};
