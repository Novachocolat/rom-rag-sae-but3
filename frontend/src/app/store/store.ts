import { configureStore } from '@reduxjs/toolkit'

export const store = configureStore({
  reducer: {
    // TODO (@ThFoxY, US2.5): add the `filters` slice (search, platform, source, page, sort)
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
