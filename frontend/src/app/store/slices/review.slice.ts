import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type ReviewTab = 'identifications' | 'collections'

// State structure of the review queue
export interface ReviewState {
  tab: ReviewTab
  indexes: Record<ReviewTab, number> // Current item of each tab
  excludedRomIds: Record<string, string[]> // Provisional exclusions, by collection ID
}

// Initializes with a default state
const initialState: ReviewState = {
  tab: 'identifications',
  indexes: { identifications: 0, collections: 0 },
  excludedRomIds: {},
}

// Review slice with its reducers
export const reviewSlice = createSlice({
  name: 'review',
  initialState,
  reducers: {
    setTab(state, action: PayloadAction<ReviewTab>) {
      state.tab = action.payload
    },
    // Moves the current item of the visible tab
    setIndex(state, action: PayloadAction<number>) {
      state.indexes[state.tab] = Math.max(0, action.payload)
    },
    toggleExcluded(
      state,
      action: PayloadAction<{ collectionId: string; romId: string }>,
    ) {
      const { collectionId, romId } = action.payload
      const current = state.excludedRomIds[collectionId] ?? []
      state.excludedRomIds[collectionId] = current.includes(romId)
        ? current.filter((id) => id !== romId)
        : [...current, romId]
    },
    clearExcluded(state, action: PayloadAction<string>) {
      delete state.excludedRomIds[action.payload]
    },
    resetReview() {
      return initialState
    },
  },
})

export const { setTab, setIndex, toggleExcluded, clearExcluded, resetReview } =
  reviewSlice.actions
export default reviewSlice.reducer
