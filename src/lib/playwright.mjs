// Playwright is an optional peer dependency: only the browser tools need it, so it loads on use.
import { TablefactsError } from './errors.mjs'

export async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && /playwright/.test(error.message ?? '')) {
      throw new TablefactsError('playwright is not installed. The browser tools need it. Install it with: npm install playwright', 'EDEPENDENCY', { cause: error })
    }
    throw error
  }
}
