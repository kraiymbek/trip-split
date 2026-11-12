import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { errMsg, supabase } from '../lib/supabase'
import { SearchX } from 'lucide-react'
import { Button } from '../components/ui'
import { AppSplash } from '../components/Loading'

export default function Join() {
  const { code } = useParams()
  const nav = useNavigate()
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (!code || started.current) return
    started.current = true
    supabase.rpc('join_trip', { p_code: code }).then(({ data, error }) => {
      if (error) setError(errMsg(error))
      else nav(`/t/${data}`, { replace: true })
    })
  }, [code, nav])

  if (!error) return <AppSplash text="Подключаем к поездке…" />
  return (
    <div className="mx-auto max-w-md px-5 pt-24 text-center">
      <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <SearchX className="size-7" aria-hidden />
      </span>
      <p className="mb-6 text-muted-foreground">{error}</p>
      <Button asChild variant="ghost">
        <Link to="/">К списку поездок</Link>
      </Button>
    </div>
  )
}
