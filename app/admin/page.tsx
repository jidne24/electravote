'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

// --- TYPES & CONFIG ---
const ROLE_ORDER = [
  "President", "Vice-President", "General Secretary", "Joint General Secretary",
  "Organizational Secretary", "Assistant Organizational Secretary", "Office Secretary",
  "Publicity & Publications Secretary", "Education & Research Secretary",
  "International Secretary (Europe)", "Science & Information Technology Secretary",
  "Social Welfare Secretary", "Executive Member"
]

type Candidate = { id: number; voter_no: number; role_name: string; name: string; vote_count: number }
type GroupedCandidates = { [role: string]: Candidate[] }

export default function AdminPage() {
  const router = useRouter()
  
  // --- AUTH STATE ---
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [adminPass, setAdminPass] = useState('')
  
  // --- ELECTION STATE ---
  const [status, setStatus] = useState('loading') 
  const [startTimeInput, setStartTimeInput] = useState('')
  const [endTimeInput, setEndTimeInput] = useState('')
  const [activeEndTime, setActiveEndTime] = useState<Date | null>(null)
  const [timeLeft, setTimeLeft] = useState('--:--:--')
  
  // --- DATA STATE ---
  const [logs, setLogs] = useState<string[]>([])
  const [allCandidates, setAllCandidates] = useState<Candidate[]>([])
  const [groupedResults, setGroupedResults] = useState<GroupedCandidates>({})
  const [isRefreshing, setIsRefreshing] = useState(false)

  // --- REFS (For preventing dependency loops) ---
  const inputsLoaded = useRef(false)

  // 1. CHECK LOGIN
  useEffect(() => {
    const savedAuth = localStorage.getItem('admin_auth_token')
    if (savedAuth === 'valid_session_2025') setIsAuthenticated(true)
  }, [])

  const handleLogin = () => {
    if (adminPass === process.env.NEXT_PUBLIC_ADMIN_PASSWORD) { 
      localStorage.setItem('admin_auth_token', 'valid_session_2025')
      setIsAuthenticated(true)
    } else {
      alert('Access Denied')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('admin_auth_token')
    setIsAuthenticated(false)
  }

  // 2. DATA FETCHING (Separated for stability)
  const refreshTabulation = useCallback(async () => {
    setIsRefreshing(true)
    const { data: candidates } = await supabase
      .from('candidates')
      .select('*')
      .order('vote_count', { ascending: false })
    
    if (candidates) setAllCandidates(candidates)
    setIsRefreshing(false)
  }, [])

  const fetchInitialSettings = useCallback(async () => {
    const { data: settings } = await supabase.from('election_settings').select('*').single()
    if (settings) {
      setStatus(settings.status)
      if (settings.end_time) setActiveEndTime(new Date(settings.end_time))
      
      // Only set inputs ONCE to avoid overwriting user typing
      if (!inputsLoaded.current) {
        const now = new Date()
        // Adjust to local time string for input field
        const localStart = settings.start_time ? new Date(settings.start_time) : now
        localStart.setMinutes(localStart.getMinutes() - localStart.getTimezoneOffset())
        
        const localEnd = settings.end_time ? new Date(settings.end_time) : new Date(now.getTime() + 60 * 60000)
        localEnd.setMinutes(localEnd.getMinutes() - localEnd.getTimezoneOffset())

        setStartTimeInput(localStart.toISOString().slice(0, 16))
        setEndTimeInput(localEnd.toISOString().slice(0, 16))
        inputsLoaded.current = true
      }
    }
    // Fetch candidates immediately
    refreshTabulation()
  }, [refreshTabulation])

  // 3. DATA PROCESSING (Grouping)
  useEffect(() => {
    const grouped = allCandidates.reduce((acc: GroupedCandidates, curr: Candidate) => {
      if (!acc[curr.role_name]) acc[curr.role_name] = []
      acc[curr.role_name].push(curr)
      return acc
    }, {})
    
    Object.keys(grouped).forEach(role => {
      grouped[role].sort((a, b) => b.vote_count - a.vote_count)
    })
    
    setGroupedResults(grouped)
  }, [allCandidates])

  // 4. REALTIME LISTENERS (Stable Dependency Array)
  useEffect(() => {
    if (!isAuthenticated) return

    fetchInitialSettings()

    // Channel A: VOTER LOGS
    const voterSub = supabase.channel('admin-voters-log')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'voters' }, (payload) => {
        if (payload.new.has_voted) {
          const time = new Date(payload.new.voted_at).toLocaleTimeString()
          setLogs((prev) => [`Voter ${payload.new.email} voted at ${time}`, ...prev])
        }
      })
      .subscribe()

    // Channel B: LIVE CANDIDATE UPDATES (Optimistic Patching)
    const candidateSub = supabase.channel('admin-candidates-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'candidates' }, (payload) => {
         const updatedCandidate = payload.new as Candidate
         setAllCandidates((prev) => 
           prev.map((c) => c.id === updatedCandidate.id ? updatedCandidate : c)
         )
      })
      .subscribe()

    // Channel C: SETTINGS
    const settingsSub = supabase.channel('admin-settings-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'election_settings' }, (payload) => {
         if (payload.new.status) setStatus(payload.new.status)
         if (payload.new.end_time) setActiveEndTime(new Date(payload.new.end_time))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(voterSub)
      supabase.removeChannel(candidateSub)
      supabase.removeChannel(settingsSub)
    }
  }, [isAuthenticated, fetchInitialSettings])

  // 5. TIMER
  useEffect(() => {
    const timer = setInterval(() => {
      if (status === 'ongoing' && activeEndTime) {
        const now = new Date()
        const diff = activeEndTime.getTime() - now.getTime()

        if (diff <= 0) {
          setTimeLeft('00:00:00')
          setStatus('ended') 
        } else {
          const h = Math.floor((diff / (1000 * 60 * 60)) % 24)
          const m = Math.floor((diff / (1000 * 60)) % 60)
          const s = Math.floor((diff / 1000) % 60)
          setTimeLeft(`${h}:${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`)
        }
      } else {
        setTimeLeft('--:--:--')
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [status, activeEndTime])

  // 6. ACTIONS
  async function startElection() {
    if (!window.confirm("CONFIRM: Activate Election Session?\nCheck start and end times carefully.")) return

    const start = new Date(startTimeInput)
    const end = new Date(endTimeInput)

    setStatus('ongoing')
    setActiveEndTime(end)

    await supabase.from('election_settings')
      .update({ status: 'ongoing', start_time: start.toISOString(), end_time: end.toISOString() })
      .eq('id', 1)
  }

  async function endElection() {
    if (!window.confirm("WARNING: Emergency Stop.\nThis will close voting immediately.")) return

    setStatus('ended')
    setTimeLeft('00:00:00')

    await supabase.from('election_settings').update({ status: 'ended' }).eq('id', 1)
  }

  // --- VIEW: LOGIN ---
  if (!isAuthenticated) {
    return (
       <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-100 to-emerald-100 flex flex-col items-center justify-center p-6 font-sans">
        <div className="text-center mb-8">
          <h1 className="text-teal-900 font-extrabold text-xl uppercase tracking-widest">System Administration</h1>
          <p className="text-teal-600 text-xs font-serif italic">GEB Alumni Association Election Control</p>
        </div>
        <div className="w-full max-w-sm bg-white/60 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/40 overflow-hidden relative">
          <div className="h-1 bg-gradient-to-r from-teal-400 to-emerald-500 w-full"></div>
          <div className="p-8 space-y-4">
             <input type="password" className="w-full bg-white/50 border border-teal-200/60 text-teal-900 p-3 rounded-xl focus:bg-white focus:border-teal-500 outline-none transition-all" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} placeholder="••••••••"/>
            <button onClick={handleLogin} className="w-full bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-bold py-3 rounded-xl shadow-lg hover:opacity-90 transition">Authenticate</button>
          </div>
        </div>
      </div>
    )
  }

  // --- VIEW: DASHBOARD ---
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      <header className="bg-teal-900 text-white sticky top-0 z-30 shadow-lg backdrop-blur-md border-b border-teal-700">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="font-bold text-sm md:text-lg uppercase tracking-widest text-teal-100">Election Control</h1>
            <p className="text-[10px] text-teal-400">Admin Console</p>
          </div>
          <div className="flex items-center space-x-4">
            <button onClick={handleLogout} className="text-[10px] text-teal-300 hover:text-white underline mr-4">LOGOUT</button>
            {status === 'ongoing' && (
               <div className="bg-black/20 px-4 py-1.5 rounded-lg border border-white/10 backdrop-blur-sm">
                <span className="text-[9px] text-teal-300 uppercase font-bold mr-2">Time Remaining</span>
                <span className="font-mono font-bold text-white text-lg">{timeLeft}</span>
              </div>
            )}
            <div className={`px-4 py-1.5 rounded text-xs font-bold uppercase tracking-widest ${
              status === 'ongoing' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 
              status === 'ended' ? 'bg-slate-600 text-slate-200' : 'bg-amber-500 text-white'
            }`}>
              {status.replace('_', ' ')}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
          
          {/* CONTROLS */}
          <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between relative overflow-hidden">
            <div className="h-1 absolute top-0 left-0 w-full bg-gradient-to-r from-teal-500 to-blue-500"></div>
            <div>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Session Configuration</h2>
              
              {status === 'not_started' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-teal-700 uppercase mb-1">Start Date & Time</label>
                    <input type="datetime-local" value={startTimeInput} onChange={(e) => setStartTimeInput(e.target.value)} className="w-full border border-slate-300 p-2 rounded-lg text-sm font-mono focus:border-teal-500 outline-none"/>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-teal-700 uppercase mb-1">End Date & Time</label>
                    <input type="datetime-local" value={endTimeInput} onChange={(e) => setEndTimeInput(e.target.value)} className="w-full border border-slate-300 p-2 rounded-lg text-sm font-mono focus:border-teal-500 outline-none"/>
                  </div>
                  <button onClick={startElection} className="w-full bg-emerald-600 text-white py-3 rounded-lg font-bold hover:bg-emerald-700 shadow-md transition-all mt-2">Activate Session</button>
                </div>
              )}

              {status === 'ongoing' && (
                <div className="text-center py-8 space-y-4">
                   <div className="inline-block px-4 py-2 bg-emerald-50 rounded-full border border-emerald-100 animate-pulse">
                      <span className="text-emerald-600 font-bold text-xs uppercase">● System Live</span>
                   </div>
                   <p className="text-xs text-slate-500">Session will auto-close at:<br/><span className="font-mono font-bold">{activeEndTime?.toLocaleString()}</span></p>
                   <button onClick={endElection} className="w-full bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 shadow-md transition-all">Force Stop</button>
                </div>
              )}

              {status === 'ended' && (
                 <div className="text-center py-10 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-slate-500 font-bold text-sm uppercase">Election Concluded</span>
                 </div>
              )}
            </div>

            <div className="mt-6 pt-6 border-t border-slate-100">
              <button 
                onClick={() => router.push('/admin/ballots')}
                disabled={status === 'ongoing'}
                className={`w-full flex justify-between items-center px-4 py-3 rounded-lg border font-bold uppercase text-xs tracking-wider transition-all ${
                  status === 'ongoing' 
                    ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed' 
                    : 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100 hover:shadow-md'
                }`}
              >
                <span>📂 Official Ballots</span>
                <span>View Archive →</span>
              </button>
            </div>
          </div>

          {/* LOGS */}
          <div className="lg:col-span-2 bg-slate-900 rounded-xl shadow-sm border border-slate-800 overflow-hidden flex flex-col h-96">
             <div className="bg-slate-800 px-4 py-3 border-b border-slate-700 flex justify-between items-center">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Live Data Stream</span>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping"></div>
                <span className="text-[10px] text-emerald-400 font-mono">{logs.length} packets</span>
              </div>
            </div>
            <div className="p-4 overflow-y-auto flex-1 font-mono text-[11px] space-y-1.5 scrollbar-thin scrollbar-thumb-slate-700">
              {logs.length === 0 && <div className="text-slate-600 italic mt-20 text-center">Waiting for voter activity...</div>}
              {logs.map((log, i) => (
                <div key={i} className="text-emerald-400 border-b border-slate-800/50 pb-1 flex items-start">
                  <span className="text-slate-500 mr-3 min-w-[60px]">[{new Date().toLocaleTimeString()}]</span>
                  <span>{log}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RESULTS TABLE */}
        <div className="flex items-center justify-between mb-6 border-b border-slate-200 pb-2">
           <div className="flex items-center space-x-2">
              <span className="w-1 h-6 bg-blue-600 rounded-full"></span>
              <h2 className="text-xl font-bold text-slate-800">Live Tabulation</h2>
           </div>
           <button 
             onClick={refreshTabulation} 
             disabled={isRefreshing}
             className="flex items-center gap-2 bg-white border border-slate-300 px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition shadow-sm"
           >
             <span className={isRefreshing ? 'animate-spin' : ''}>↻</span>
             {isRefreshing ? 'Syncing...' : 'Sync Now'}
           </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 pb-20">
          {ROLE_ORDER.map((roleName) => {
            const candidates = groupedResults[roleName] || []
            if (candidates.length === 0) return null
            return (
              <div key={roleName} className="bg-white shadow-sm rounded-xl border border-slate-200 overflow-hidden flex flex-col h-full transition-shadow hover:shadow-md">
                <div className="bg-gradient-to-r from-slate-50 to-white px-4 py-3 border-b border-slate-100">
                  <h3 className="font-bold text-xs text-teal-700 uppercase tracking-wide">{roleName}</h3>
                </div>
                <table className="w-full text-left text-sm">
                   <tbody>
                    {candidates.map((c, idx) => (
                      <tr key={c.id} className="hover:bg-slate-50 transition border-b border-slate-50 last:border-0">
                        <td className="px-4 py-2.5 text-[10px] text-slate-400 font-mono w-10">{String(c.voter_no).padStart(3, '0')}</td>
                        <td className={`px-4 py-2.5 font-medium text-slate-700 ${idx === 0 && c.vote_count > 0 ? 'text-emerald-700 font-bold' : ''}`}>{c.name}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-slate-900 text-lg">{c.vote_count}</td>
                      </tr>
                    ))}
                   </tbody>
                </table>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}