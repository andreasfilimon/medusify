import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
      // Google is the stand-in provider in ./src/modules/fake-google. Same allowlist shape as a real Google provider.
      authMethodsPerActor: { user: ['emailpass', 'google'] },
    }
  },
  modules: [
    {
      resolve: '@medusajs/medusa/auth',
      dependencies: ['cache', 'logger'],
      options: {
        providers: [
          { resolve: '@medusajs/medusa/auth-emailpass', id: 'emailpass' },
          { resolve: './src/modules/fake-google', id: 'google' },
        ],
      },
    },
  ],
  plugins: [
    {
      resolve: 'medusify',
      options: {
        vapid: {
          publicKey: process.env.MEDUSIFY_VAPID_PUBLIC_KEY,
          privateKey: process.env.MEDUSIFY_VAPID_PRIVATE_KEY,
          subject: process.env.MEDUSIFY_VAPID_SUBJECT,
        },
        storeLabel: 'Devshop',
        locale: 'de',
        // Dev loop: serve the app build straight from the plugin folder (set in .env, absolute path)
        pwaDir: process.env.MEDUSIFY_PWA_DIR || undefined,
      },
    },
  ],
})
