/*
 * Fill in CLIENT_ID with the OAuth 2.0 Client ID from Google Cloud Console
 * (APIs & Services > Credentials > Create credentials > OAuth client ID >
 *  Web application), with this exact Authorized JavaScript origin:
 *
 *     https://edy-hashiba.github.io
 *
 * Add http://localhost:8795 too if you want to test the sync locally.
 *
 * This is a public identifier and is safe to commit. The client SECRET is NOT
 * used here and must never be put in this file: anything in a web page can be
 * read by anyone who opens it.
 */
window.OALD_CONFIG = {
  CLIENT_ID: '629465365561-cttsc5ak4um6670t6t0v3lisb34otolf.apps.googleusercontent.com',

  /* Only files this app created are visible to it - nothing else in Drive. */
  SCOPE: 'https://www.googleapis.com/auth/drive.file',

  /* The file the collection is kept in, in the root of your Drive. */
  FILE_NAME: 'oald-vocab.json'
};
