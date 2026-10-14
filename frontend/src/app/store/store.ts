import { configureStore } from '@reduxjs/toolkit'
import filtersReducer from './slices/filters.slice'
import reviewReducer from './slices/review.slice'

export const store = configureStore({
  reducer: {
    filters: filtersReducer,
    review: reviewReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
