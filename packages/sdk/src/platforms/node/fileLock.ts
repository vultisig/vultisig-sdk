import koffi from 'koffi'

type NativeFileLock = {
  tryLock(fd: number): boolean
  unlock(fd: number): void
}

const createPosixFileLock = (): NativeFileLock => {
  const processLibrary = koffi.load(null)
  const flock = processLibrary.func('int flock(int fd, int operation)')
  const LOCK_EX = 2
  const LOCK_NB = 4
  const LOCK_UN = 8

  return {
    tryLock(fd) {
      koffi.errno(0)
      if (flock(fd, LOCK_EX | LOCK_NB) === 0) return true

      const errorNumber = koffi.errno()
      if (
        errorNumber === koffi.os.errno.EACCES ||
        errorNumber === koffi.os.errno.EAGAIN ||
        errorNumber === koffi.os.errno.EBUSY
      ) {
        return false
      }

      throw new Error(`Failed to lock file descriptor ${fd} (errno ${errorNumber})`)
    },
    unlock(fd) {
      koffi.errno(0)
      if (flock(fd, LOCK_UN) !== 0) {
        throw new Error(`Failed to unlock file descriptor ${fd} (errno ${koffi.errno()})`)
      }
    },
  }
}

const createWindowsFileLock = (): NativeFileLock => {
  const processLibrary = koffi.load(null)
  const kernel32 = koffi.load('kernel32.dll')
  const overlapped = koffi.struct({
    internal: 'uintptr_t',
    internalHigh: 'uintptr_t',
    offset: 'uint32_t',
    offsetHigh: 'uint32_t',
    event: 'void *',
  })
  // Node owns these descriptors through libuv, so converting them through a
  // separately loaded CRT can address the wrong descriptor table on Windows.
  const getOsFileHandle = processLibrary.func('void * uv_get_osfhandle(int fd)')
  const lockFile = kernel32.func('__stdcall', 'LockFileEx', 'int', [
    'void *',
    'uint32_t',
    'uint32_t',
    'uint32_t',
    'uint32_t',
    koffi.pointer(overlapped),
  ])
  const unlockFile = kernel32.func('__stdcall', 'UnlockFileEx', 'int', [
    'void *',
    'uint32_t',
    'uint32_t',
    'uint32_t',
    koffi.pointer(overlapped),
  ])
  const getLastError = kernel32.func('__stdcall', 'GetLastError', 'uint32_t', [])
  const LOCKFILE_FAIL_IMMEDIATELY = 1
  const LOCKFILE_EXCLUSIVE_LOCK = 2
  const ERROR_LOCK_VIOLATION = 33
  const INVALID_HANDLE_VALUE = (1n << BigInt(koffi.sizeof('void *') * 8)) - 1n

  const newOverlapped = () => ({
    internal: 0,
    internalHigh: 0,
    offset: 0,
    offsetHigh: 0,
    event: null,
  })

  const getValidatedOsFileHandle = (fd: number) => {
    const handle = getOsFileHandle(fd)
    if (handle === null || koffi.address(handle) === INVALID_HANDLE_VALUE) {
      throw new Error(`Failed to resolve the Windows handle for file descriptor ${fd}`)
    }
    return handle
  }

  return {
    tryLock(fd) {
      const handle = getValidatedOsFileHandle(fd)
      if (lockFile(handle, LOCKFILE_FAIL_IMMEDIATELY | LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, newOverlapped())) {
        return true
      }

      const errorNumber = getLastError()
      if (errorNumber === ERROR_LOCK_VIOLATION) return false
      throw new Error(`Failed to lock file descriptor ${fd} (Windows error ${errorNumber})`)
    },
    unlock(fd) {
      const handle = getValidatedOsFileHandle(fd)
      if (!unlockFile(handle, 0, 1, 0, newOverlapped())) {
        throw new Error(`Failed to unlock file descriptor ${fd} (Windows error ${getLastError()})`)
      }
    },
  }
}

let nativeFileLock: NativeFileLock | undefined

const getNativeFileLock = (): NativeFileLock =>
  (nativeFileLock ??= process.platform === 'win32' ? createWindowsFileLock() : createPosixFileLock())

export const tryLockFile = (fd: number): boolean => getNativeFileLock().tryLock(fd)

export const unlockFile = (fd: number): void => getNativeFileLock().unlock(fd)
