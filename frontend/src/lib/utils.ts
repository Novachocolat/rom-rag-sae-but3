import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// clsx is a package used to merge conditional class names and resolves conflicting Tailwind utilities

// Helper function to merge class names and resolve conflicts using clsx and tailwind-merge
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
