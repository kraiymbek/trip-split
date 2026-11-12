import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-pulse rounded-md bg-foreground/[0.07] motion-reduce:animate-none', className)}
      {...props}
    />
  )
}

export { Skeleton }
