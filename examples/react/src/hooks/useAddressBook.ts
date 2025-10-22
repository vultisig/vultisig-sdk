import { useCallback, useEffect, useState } from 'react'
import type { AddressBook, Vultisig } from 'vultisig-sdk'

export function useAddressBook(sdk: Vultisig) {
  const [addressBook, setAddressBook] = useState<AddressBook>({
    saved: [],
    vaults: [],
  })
  const [loading, setLoading] = useState(true)

  const refreshAddressBook = useCallback(async () => {
    try {
      setLoading(true)
      const book = await sdk.getAddressBook()
      setAddressBook(book)
    } catch (err) {
      console.error('Failed to load address book:', err)
    } finally {
      setLoading(false)
    }
  }, [sdk])

  useEffect(() => {
    refreshAddressBook()
  }, [refreshAddressBook])

  const getTotalCount = useCallback(() => {
    return addressBook.saved.length + addressBook.vaults.length
  }, [addressBook])

  return {
    addressBook,
    loading,
    refreshAddressBook,
    getTotalCount,
  }
}

