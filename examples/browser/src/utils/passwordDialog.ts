/**
 * In-page password prompt for `onPasswordRequired` — replaces `window.prompt`
 * so automated browsers and QA can interact, and UX is consistent.
 */
import { VaultError, VaultErrorCode } from '@vultisig/sdk'

let dialogChain: Promise<void> = Promise.resolve()

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function isVisibleFocusable(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  return !!(el.offsetWidth || el.offsetHeight || style.position === 'fixed')
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => {
    if (el.closest('[aria-hidden="true"]')) return false
    return isVisibleFocusable(el)
  })
}

export function requestVaultPasswordInPage(vaultId: string, vaultName?: string): Promise<string> {
  const titleName = vaultName?.trim() || vaultId.slice(0, 8)

  const run = (): Promise<string> =>
    new Promise((resolve, reject) => {
      if (typeof document === 'undefined') {
        reject(new VaultError(VaultErrorCode.BrowserDocumentRequired, 'Password dialog requires a browser document'))
        return
      }

      const prevActive = document.activeElement instanceof HTMLElement ? document.activeElement : null

      const root = document.createElement('div')
      root.setAttribute('data-vultisig-password-root', 'true')

      const backdrop = document.createElement('div')
      backdrop.setAttribute('role', 'presentation')
      backdrop.style.cssText =
        'position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box'

      const panel = document.createElement('div')
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-modal', 'true')
      panel.setAttribute('aria-labelledby', 'vultisig-password-dialog-title')
      panel.style.cssText =
        'background:#fff;border-radius:12px;max-width:420px;width:100%;padding:24px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.35);font-family:system-ui,sans-serif'

      const heading = document.createElement('h2')
      heading.id = 'vultisig-password-dialog-title'
      heading.textContent = 'Unlock vault'
      heading.style.cssText = 'margin:0 0 8px;font-size:1.125rem;font-weight:600;color:#0f172a'

      const subtitle = document.createElement('p')
      subtitle.textContent = `Enter the password for “${titleName}”.`
      subtitle.style.cssText = 'margin:0 0 16px;font-size:0.875rem;color:#475569;line-height:1.5'

      const label = document.createElement('label')
      label.setAttribute('for', 'vultisig-password-field')
      label.textContent = 'Password'
      label.style.cssText = 'display:block;font-size:0.75rem;font-weight:600;color:#334155;margin-bottom:6px'

      const input = document.createElement('input')
      input.id = 'vultisig-password-field'
      input.type = 'password'
      input.autocomplete = 'off'
      input.setAttribute('data-testid', 'vultisig-password-input')
      input.style.cssText =
        'width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:1rem'

      const actions = document.createElement('div')
      actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:20px'

      const btnCancel = document.createElement('button')
      btnCancel.type = 'button'
      btnCancel.textContent = 'Cancel'
      btnCancel.setAttribute('data-testid', 'vultisig-password-cancel')
      btnCancel.style.cssText =
        'padding:8px 16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-weight:500;cursor:pointer'

      const btnOk = document.createElement('button')
      btnOk.type = 'button'
      btnOk.textContent = 'Unlock'
      btnOk.setAttribute('data-testid', 'vultisig-password-submit')
      btnOk.style.cssText =
        'padding:8px 16px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:600;cursor:pointer'

      const cancelled = () => new VaultError(VaultErrorCode.PasswordEntryCancelled, 'Password entry was cancelled')

      const teardown = (restoreFocus: boolean) => {
        document.removeEventListener('keydown', onKeyDown, true)
        backdrop.removeEventListener('click', onBackdropClick)
        root.remove()
        if (restoreFocus && prevActive?.focus) {
          prevActive.focus()
        }
      }

      const finishReject = (err: Error) => {
        teardown(true)
        reject(err)
      }

      const finishResolve = (password: string) => {
        teardown(true)
        resolve(password)
      }

      const onBackdropClick = (e: MouseEvent) => {
        if (e.target === backdrop) {
          finishReject(cancelled())
        }
      }

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finishReject(cancelled())
          return
        }

        if (e.key !== 'Tab') return

        const focusables = getFocusableElements(panel)
        if (focusables.length === 0) {
          e.preventDefault()
          return
        }

        if (focusables.length === 1) {
          e.preventDefault()
          focusables[0].focus()
          return
        }

        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement as HTMLElement | null

        if (e.shiftKey) {
          if (active === first || !panel.contains(active)) {
            e.preventDefault()
            last.focus()
          }
        } else if (active === last || !panel.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }

      btnCancel.onclick = () => finishReject(cancelled())

      btnOk.onclick = () => {
        const value = input.value
        if (!value) {
          input.focus()
          return
        }
        finishResolve(value)
      }

      input.onkeydown = e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          btnOk.click()
        }
      }

      actions.append(btnCancel, btnOk)
      panel.append(heading, subtitle, label, input, actions)
      backdrop.append(panel)
      root.append(backdrop)
      document.body.append(root)

      document.addEventListener('keydown', onKeyDown, true)
      backdrop.addEventListener('click', onBackdropClick)

      requestAnimationFrame(() => {
        input.focus()
      })
    })

  const scheduled = dialogChain.then(run)
  dialogChain = scheduled.then(
    () => {},
    () => {}
  )
  return scheduled
}
