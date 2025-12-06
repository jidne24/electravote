'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function BallotIndex() {
  const router = useRouter()
  const [ballots, setBallots] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    // 1. Auth Check
    const savedAuth = localStorage.getItem('admin_auth_token')
    if (savedAuth !== 'valid_session_2025') {
      router.push('/admin') 
      return
    }

    // 2. Fetch Data (Safe Mode)
    async function fetchData() {
      try {
        // We select '*' to avoid "column not found" errors
        // We order by 'id' because it's guaranteed to exist
        const { data, error } = await supabase
          .from('ballots')
          .select('*')
          .order('id', { ascending: true }) 
        
        if (error) {
          console.error("Supabase Error Details:", error)
          throw new Error(error.message)
        }
        
        if (data) setBallots(data)
      } catch (err: any) {
        console.error("Full Error Object:", err)
        setErrorMsg(err.message || "Unknown Database Error")
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [router])

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-100 to-emerald-100 flex items-center justify-center font-sans">
      <div className="bg-white/50 px-8 py-4 rounded-full backdrop-blur text-teal-800 font-bold animate-pulse">
        Accessing Secure Archive...
      </div>
    </div>
  )

  if (errorMsg) return (
    <div className="min-h-screen bg-teal-50 flex flex-col items-center justify-center p-8 text-center">
       <h1 className="text-red-600 font-bold text-2xl mb-4">Database Connection Error</h1>
       <p className="text-slate-700 bg-white p-4 rounded shadow mb-6 font-mono text-sm">{errorMsg}</p>
       <p className="text-slate-500 text-sm max-w-md">
         Tip: If the error says "relation does not exist", your table name is wrong. 
         If it says "column does not exist", you are missing a column. 
         If empty, check Row Level Security (RLS) policies in Supabase.
       </p>
       <Link href="/admin" className="text-blue-600 hover:underline">Back to Admin</Link>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-100 to-emerald-100 font-sans p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-extrabold text-teal-900 uppercase tracking-wide">Ballot Archive</h1>
            <p className="text-sm text-teal-700 mt-1">Total Records: {ballots.length}</p>
          </div>
          <Link href="/admin" className="bg-white text-teal-700 px-5 py-2 rounded-lg text-sm font-bold shadow-sm hover:shadow-md transition">
            ← Return to Dashboard
          </Link>
        </div>

        {ballots.length === 0 ? (
          <div className="text-center p-12 bg-white/60 rounded-xl border border-white/40">
             <p className="text-teal-800 font-medium">No ballots have been cast yet.</p>
          </div>
        ) : (
          <div className="bg-white/80 backdrop-blur-xl border border-white/50 rounded-2xl shadow-xl overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-teal-900/5 text-teal-700 uppercase text-xs font-bold border-b border-teal-100">
                <tr>
                  <th className="p-5 w-20 text-center">#</th>
                  <th className="p-5">Digital Ledger ID (UUID)</th>
                  <th className="p-5">Timestamp</th>
                  <th className="p-5 text-right">Document</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-teal-50">
                {ballots.map((ballot, index) => (
                  <tr key={ballot.id} className="hover:bg-teal-50/50 transition">
                    <td className="p-5 text-center font-mono text-teal-400 text-xs">{index + 1}</td>
                    <td className="p-5 font-mono text-slate-600 text-xs">{ballot.id}</td>
                    <td className="p-5 text-slate-500 text-xs">
                      {/* Fallback if created_at is missing */}
                      {ballot.created_at 
                        ? new Date(ballot.created_at).toLocaleString() 
                        : <span className="text-slate-300 italic">No Timestamp</span>
                      }
                    </td>
                    <td className="p-5 text-right">
                      <Link 
                        href={`/admin/ballots/${ballot.id}`}
                        target="_blank"
                        className="bg-teal-600 text-white px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest hover:bg-teal-700 transition shadow-sm"
                      >
                        View / Print
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}