'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

// --- CONFIGURATION ---
const MAX_VOTES_PER_ROLE: { [key: string]: number } = {
  "President": 1,
  "Vice-President": 2,
  "General Secretary": 1,
  "Joint General Secretary": 2,
  "Organizational Secretary": 1,
  "Assistant Organizational Secretary": 2,
  "Office Secretary": 1,
  "Publicity & Publications Secretary": 1,
  "Education & Research Secretary": 1,
  "International Secretary (Europe)": 1,
  "Science & Information Technology Secretary": 1,
  "Social Welfare Secretary": 1,
  "Executive Member": 1
}

const ROLE_ORDER = [
  "President", "Vice-President", "General Secretary", "Joint General Secretary",
  "Organizational Secretary", "Assistant Organizational Secretary", "Office Secretary",
  "Publicity & Publications Secretary", "Education & Research Secretary",
  "International Secretary (Europe)", "Science & Information Technology Secretary",
  "Social Welfare Secretary", "Executive Member"
]

type Candidate = { id: number; voter_no: number; role_name: string; name: string }
type GroupedCandidates = { [role: string]: Candidate[] }

export default function VoterPage() {
  const [stage, setStage] = useState<'login' | 'waiting' | 'voting' | 'success'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  
  const [candidates, setCandidates] = useState<GroupedCandidates>({})
  const [endTime, setEndTime] = useState<Date | null>(null)
  const [timeLeft, setTimeLeft] = useState('')
  const [selections, setSelections] = useState<{ [role: string]: number[] }>({})

  // --- LOGIN ---
  async function handleLogin() {
    if (!email || !otp) { setError('Please enter both Email and Access Code.'); return }
    setLoading(true); setError('');
    
    try {
      const { data: settings } = await supabase.from('election_settings').select('*').single()
      if (!settings) { setError("System Offline."); setLoading(false); return }
      
      if (settings.status === 'not_started') { setStage('waiting'); setLoading(false); return }
      
      const now = new Date()
      const end = new Date(settings.end_time)
      // 10 second buffer for network latency
      if (settings.status === 'ended' || now.getTime() > end.getTime() + 10000) { 
          setError('The election period has officially ended.'); 
          setLoading(false); 
          return 
      }
      
      setEndTime(end)

      const { data: voter, error: voterError } = await supabase.from('voters').select('*').eq('email', email).eq('otp', otp.trim()).single()
      if (voterError || !voter) { setError('Access Denied. Invalid Credentials.'); setLoading(false); return }
      if (voter.has_voted) { setError('Record Found: You have already cast your vote.'); setLoading(false); return }

      const { data: candList } = await supabase.from('candidates').select('*').order('voter_no', { ascending: true })
      if (candList) {
        const grouped = candList.reduce((acc: GroupedCandidates, curr: Candidate) => {
          if (!acc[curr.role_name]) acc[curr.role_name] = []; acc[curr.role_name].push(curr); return acc
        }, {})
        setCandidates(grouped)
        setStage('voting')
      }
    } catch (err) { setError('System Connection Error. Please try again.'); }
    setLoading(false)
  }

  // --- TIMER ---
  useEffect(() => {
    if (stage !== 'voting' || !endTime) return
    const timer = setInterval(() => {
      const now = new Date(); const diff = endTime.getTime() - now.getTime()
      if (diff <= 0) { 
          setTimeLeft('00:00:00'); 
          alert('Session Expired: The voting window has closed.'); 
          window.location.reload() 
      }
      else {
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24); const m = Math.floor((diff / (1000 * 60)) % 60); const s = Math.floor((diff / 1000) % 60)
        setTimeLeft(`${h}:${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [stage, endTime])

  // --- SELECTION ---
  function toggleCandidate(role: string, id: number) {
    const currentList = selections[role] || []; const max = MAX_VOTES_PER_ROLE[role] || 1
    if (currentList.includes(id)) { setSelections({ ...selections, [role]: currentList.filter(c => c !== id) }) }
    else {
      if (currentList.length >= max) { alert(`Kind Attention:\n\nYou have already selected the maximum of ${max} candidate(s) for the role of ${role}.\n\nIf you wish to vote for this candidate, please unselect one of your current choices first.`); return }
      setSelections({ ...selections, [role]: [...currentList, id] })
    }
  }

  // --- SUBMIT (UPDATED FOR TRANSACTIONAL INTEGRITY) ---
  async function submitVote() {
    if (!window.confirm("FINAL SUBMISSION CONFIRMATION:\n\nAre you sure you are ready to cast your vote?\n\nPlease note that once submitted, this ballot cannot be changed or withdrawn.")) return
    
    setLoading(true)
    
    try {
      // 1. FLATTEN SELECTIONS FOR DB
      // Collect all selected Candidate IDs into a single array
      const allSelectedIds: number[] = []
      Object.values(selections).forEach(ids => allSelectedIds.push(...ids))

      // 2. PREPARE JSON BALLOT (For Audit Trail)
      const readableBallot: any = {}
      for (const role of ROLE_ORDER) {
        const selectedIds = selections[role] || []
        const selectedNames = selectedIds.map(id => {
          const cand = candidates[role]?.find(c => c.id === id)
          return cand ? `${cand.name} (#${cand.voter_no})` : 'Unknown'
        })
        readableBallot[role] = selectedNames.length > 0 ? selectedNames : ["NO VOTE"]
      }

      // 3. CALL MASTER RPC FUNCTION
      // This replaces the old logic. We send everything to the database at once.
      // The database handles locking, validating, and counting atomically.
      const { data, error } = await supabase.rpc('cast_vote_transaction', {
        p_email: email,
        p_otp: otp,
        p_ballot_json: readableBallot,
        p_candidate_ids: allSelectedIds
      })

      if (error) {
        console.error("RPC Error:", error)
        throw error
      }

      // 4. HANDLE RESPONSE
      if (data && data.success) {
        setStage('success')
      } else {
        // If the database logic rejected it (e.g. double vote attempt)
        alert(`Submission Failed: ${data?.message || 'Unknown error'}`)
        if (data?.message === 'Already voted') {
          window.location.reload()
        }
      }

    } catch (err: any) {
      console.error("Submission Error:", err)
      alert("System Error. Please check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }

  // --- UI SECTIONS ---
  if (stage === 'login') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-100 to-emerald-100 flex flex-col items-center justify-center p-6 font-sans">
        <div className="text-center mb-10 max-w-3xl z-10">
          <h1 className="text-teal-900 font-extrabold text-xl md:text-3xl uppercase tracking-wider mb-2 drop-shadow-sm">Department of Genetic Engineering & Biotechnology</h1>
          <h2 className="text-teal-700/80 font-medium text-xs md:text-sm uppercase tracking-[0.2em] font-serif italic">GEB Alumni Association Executive Committee Election 2025</h2>
        </div>
        <div className="w-full max-w-md bg-white/60 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/40 overflow-hidden relative z-10">
          <div className="h-1.5 bg-gradient-to-r from-teal-400 via-cyan-500 to-emerald-500 w-full"></div>
          <div className="p-8 md:p-12">
            <h3 className="text-lg font-bold text-teal-800 mb-8 text-center uppercase tracking-wide border-b border-teal-900/10 pb-4">Voter Authentication</h3>
            {error && <div className="bg-red-50/80 border border-red-200 text-red-700 p-3 rounded-lg mb-6 text-xs font-bold text-center animate-pulse">{error}</div>}
            <div className="space-y-5">
              <div className="group"><label className="block text-[10px] font-bold text-teal-600 uppercase tracking-wider mb-1.5 ml-1">Registered Email</label><input className="w-full bg-white/50 border border-teal-200/60 text-teal-900 p-3 rounded-xl focus:bg-white focus:border-teal-500 outline-none transition-all font-medium" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="student@example.com"/></div>
              <div className="group"><label className="block text-[10px] font-bold text-teal-600 uppercase tracking-wider mb-1.5 ml-1">Access Code (Numeric)</label><input className="w-full bg-white/50 border border-teal-200/60 text-teal-900 p-3 rounded-xl focus:bg-white focus:border-teal-500 outline-none transition-all font-mono tracking-[0.3em] text-center" type="text" inputMode="numeric" pattern="[0-9]*" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="••••••"/></div>
              <button onClick={handleLogin} disabled={loading} className="w-full bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-bold py-4 rounded-xl shadow-lg mt-4 tracking-wide hover:opacity-90 transition">{loading ? 'Verifying Identity...' : 'Enter Voting Booth →'}</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (stage === 'waiting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-teal-50 text-teal-900 font-sans p-4">
        <div className="text-center max-w-lg p-10 bg-white rounded-2xl shadow-xl border border-teal-100">
          <div className="text-5xl mb-6 animate-pulse">⏳</div>
          <h1 className="text-xl font-bold mb-2 text-teal-900 uppercase tracking-wide">Portal Standby</h1>
          <p className="text-sm text-teal-600 mb-8 leading-relaxed">The 2025 Executive Committee Election session has not yet been initiated by the Election Commission.</p>
          <button onClick={() => window.location.reload()} className="text-xs font-bold text-emerald-600 hover:underline uppercase tracking-widest">Refresh Connection</button>
        </div>
      </div>
    )
  }

  if (stage === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-50 font-sans p-6">
        <div className="text-center max-w-lg bg-white p-12 rounded-2xl shadow-2xl border-t-8 border-emerald-500">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6 text-emerald-600"><span className="text-4xl font-bold">✓</span></div>
          <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Ballot Sealed</h1>
          <p className="text-slate-500 text-sm mb-8">Your vote has been securely recorded on the digital ledger.</p>
          <button onClick={() => window.location.reload()} className="bg-slate-100 text-slate-600 px-8 py-3 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-slate-200 transition shadow-sm">Exit Secure Portal</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24">
      <div className="bg-teal-900 text-white sticky top-0 z-30 shadow-xl backdrop-blur-md bg-opacity-95 border-b border-teal-700">
        <div className="max-w-5xl mx-auto px-4 py-3 flex justify-between items-center">
          <div><h1 className="font-bold text-xs md:text-sm uppercase tracking-widest text-teal-100">Official Ballot</h1><p className="text-[10px] text-teal-400 font-mono">{email}</p></div>
          <div className="text-right bg-black/20 px-4 py-1.5 rounded-lg border border-white/10 backdrop-blur-sm"><p className="text-[9px] text-teal-300 uppercase font-bold tracking-wider mb-0.5">Session Timer</p><p className="text-lg md:text-xl font-mono font-bold tabular-nums text-white">{timeLeft}</p></div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {ROLE_ORDER.map((role, index) => {
           if (!candidates[role]) return null
           const maxVotes = MAX_VOTES_PER_ROLE[role] || 1
           const currentVotes = selections[role]?.length || 0
           return (
             <div key={role} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all hover:shadow-md">
               <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-100 flex justify-between items-center flex-wrap gap-2">
                 <h2 className="text-lg md:text-xl font-bold text-teal-700 leading-tight">{role}</h2>
                 <span className={`text-[10px] font-bold px-3 py-1.5 rounded-full border uppercase tracking-wide ${currentVotes === maxVotes ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-slate-500 border-slate-200'}`}>Select Max: {maxVotes}</span>
               </div>
               <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                 {candidates[role].map((cand) => {
                   const isSelected = selections[role]?.includes(cand.id)
                   return (
                     <div key={cand.id} onClick={() => toggleCandidate(role, cand.id)} className={`cursor-pointer rounded-lg p-4 flex items-center transition-all border relative overflow-hidden group ${isSelected ? 'bg-teal-700 border-teal-700 text-white shadow-md' : 'bg-white border-slate-100 hover:border-teal-200 hover:bg-teal-50/30 text-slate-700'}`}>
                       <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center border mr-3 transition-colors ${isSelected ? 'bg-white border-white' : 'bg-slate-100 border-slate-300 group-hover:border-teal-400'}`}>{isSelected && <div className="w-2.5 h-2.5 rounded-full bg-teal-700"></div>}</div>
                       <div><p className={`font-bold text-sm leading-tight ${isSelected ? 'text-white' : 'text-slate-800'}`}>{cand.name}</p><p className={`text-[10px] font-mono mt-1 ${isSelected ? 'text-teal-200' : 'text-slate-400'}`}>ID: {String(cand.voter_no).padStart(3, '0')}</p></div>
                     </div>
                   )
                 })}
               </div>
             </div>
           )
        })}
        <div className="sticky bottom-6 z-20">
           <div className="bg-white/90 backdrop-blur-md p-4 md:p-6 rounded-2xl shadow-2xl border border-teal-100 text-center max-w-xl mx-auto">
              <button onClick={submitVote} disabled={loading} className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-lg font-bold px-8 py-4 rounded-xl shadow-lg hover:shadow-emerald-900/20 transition-all transform hover:-translate-y-0.5 active:translate-y-0">{loading ? 'Encrypting & Submitting...' : 'CONFIRM & CAST VOTE'}</button>
           </div>
        </div>
      </div>
    </div>
  )
}