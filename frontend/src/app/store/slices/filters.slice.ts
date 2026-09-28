import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { IdentificationSource } from '@repo/shared/types'

// State structure of a filter
export interface FiltersState {
  search: string
  platformId: string | null
  identificationSource: IdentificationSource | null
  page: number
  sort: string | null
}

// Initializes with a default state
const initialState: FiltersState = {
  search: '',
  platformId: null,
  identificationSource: null,
  page: 1,
  sort: null,
}

// Filters slice with its reducers
export const filtersSlice = createSlice({
  name: 'filters',
  initialState,
  reducers: {
    setSearch(state, action: PayloadAction<string>) {
      state.search = action.payload
      state.page = 1 // Resets pagination on new search
    },
    setPlatformId(state, action: PayloadAction<string | null>) {
      state.platformId = action.payload
      state.page = 1
    },
    setIdentificationSource(
      state,
      action: PayloadAction<IdentificationSource | null>,
    ) {
      state.identificationSource = action.payload
      state.page = 1
    },
    setPage(state, action: PayloadAction<number>) {
      state.page = action.payload
    },
    setSort(state, action: PayloadAction<string | null>) {
      state.sort = action.payload
    },
    resetFilters() {
      return initialState
    },
  },
})

export const {
  setSearch,
  setPlatformId,
  setIdentificationSource,
  setPage,
  setSort,
  resetFilters,
} = filtersSlice.actions
export default filtersSlice.reducer
