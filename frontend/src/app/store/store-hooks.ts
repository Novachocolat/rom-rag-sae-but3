import {
  useDispatch,
  useSelector,
  type TypedUseSelectorHook,
} from 'react-redux'
import type { AppDispatch, RootState } from '@/app/store/store'

// Typed Redux hooks
export const useAppDispatch: () => AppDispatch = useDispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
