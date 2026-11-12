import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { errMsg, supabase } from '../lib/supabase'
import { Spinner } from '../components/ui'

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

  if (!error) return <Spinner full />
  return (
    <div className="mx-auto max-w-md px-5 pt-24 text-center">
      <div className="mb-2 text-4xl">🤷</div>
      <p className="mb-6 text-muted-foreground">{error}</p>
      <Link to="/" className="font-semibold text-primary">
        К списку поездок
      </Link>
    </div>
  )
}
