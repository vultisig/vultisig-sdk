import { preventDefault } from '@lib/ui/utils/preventDefault'
import { stopPropagation } from '@lib/ui/utils/stopPropagation'
import { withoutUndefinedFields } from '@lib/utils/record/withoutUndefinedFields'
import { FormEvent, KeyboardEvent } from 'react'

type GetFormPropsInput = {
  onClose?: () => void
  onSubmit?: () => void
  isDisabled?: boolean | string
  isPending?: boolean
}

export const getFormProps = ({
  onClose,
  onSubmit,
  isDisabled = false,
  isPending = false,
}: GetFormPropsInput) => {
  return withoutUndefinedFields({
    onKeyDown: onClose
      ? (event: KeyboardEvent<HTMLFormElement>) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }
      : undefined,
    onSubmit: onSubmit
      ? stopPropagation<FormEvent>(
          preventDefault(() => {
            if (isDisabled || isPending) return

            onSubmit()
          })
        )
      : undefined,
  })
}
