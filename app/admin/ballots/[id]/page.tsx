'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useParams } from 'next/navigation'

const ROLE_ORDER = [
  "President", "Vice-President", "General Secretary", "Joint General Secretary",
  "Organizational Secretary", "Assistant Organizational Secretary", "Office Secretary",
  "Publicity & Publications Secretary", "Education & Research Secretary",
  "International Secretary (Europe)", "Science & Information Technology Secretary",
  "Social Welfare Secretary", "Executive Member"
]

type Candidate = { id: number; voter_no: number; role_name: string; name: string }

export default function SingleBallotPage() {
  const params = useParams()
  const ballotId = params?.id as string
  const [ballot, setBallot] = useState<any>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ballotId) return
    async function loadData() {
      try {
        const { data: bData } = await supabase.from('ballots').select('*').eq('id', ballotId).single()
        const { data: cData } = await supabase.from('candidates').select('*').order('voter_no', { ascending: true })
        if (bData) setBallot(bData)
        if (cData) setCandidates(cData)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [ballotId])

  if (loading) return <div className="min-h-screen bg-teal-50 flex items-center justify-center text-teal-600">Retrieving Record...</div>
  if (!ballot) return <div className="p-12 text-center text-red-600">Ballot Not Found</div>

  const isSelected = (role: string, candidateName: string, candidateNo: number) => {
    if (!ballot.ballot_json) return false
    const selectedList = ballot.ballot_json[role] || []
    return selectedList.some((s: string) => s.includes(String(candidateNo)))
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-100 to-emerald-100 p-8 font-sans flex justify-center print:p-0 print:bg-white print:block">
      
      <div className="fixed top-4 right-4 print:hidden z-50">
        <button 
          onClick={() => window.print()} 
          className="bg-teal-900 text-white px-6 py-3 rounded-full shadow-xl font-bold hover:bg-teal-800 flex items-center gap-2 border border-teal-700"
        >
          <span>🖨</span> Print PDF
        </button>
      </div>

      {/* A4 CONTAINER */}
      <div className="bg-white shadow-2xl print:shadow-none w-[210mm] mx-auto p-[10mm] relative box-border text-black flex flex-col items-center print:w-full print:mx-0 print:p-4 rounded-sm">
        
        {/* HEADER */}
        <div className="w-full text-center border-b-2 border-black pb-2 mb-3">
          <h1 className="text-xl font-bold uppercase tracking-widest text-black leading-none">Official Ballot Paper</h1>
          <p className="text-[10px] font-bold uppercase text-black mt-1 italic">GEB Alumni Association Executive Committee Election 2025</p>
          <div className="absolute top-4 right-4 text-[8px] font-mono text-gray-400 print:top-2 print:right-0">
            ID: {ballot.id.substring(0,8)}
          </div>
        </div>

        {/* CONTENT */}
        <div className="w-full max-w-[170mm] space-y-2 print:space-y-2">
          {ROLE_ORDER.map((role) => {
             const roleCandidates = candidates.filter(c => c.role_name === role)
             if (roleCandidates.length === 0) return null

             return (
               <div key={role} className="avoid-break w-full">
                 <div className="bg-gray-200 border-t border-l border-r border-black font-bold text-[9px] uppercase text-center py-0.5 text-black">
                   {role}
                 </div>
                 <table className="w-full border-collapse border border-black text-[9px] table-fixed">
                   <colgroup>
                      <col className="w-[8%]" />
                      <col className="w-[12%]" />
                      <col className="w-[80%]" />
                   </colgroup>
                   <tbody>
                     {roleCandidates.map(c => {
                       const selected = isSelected(role, c.name, c.voter_no)
                       return (
                         <tr key={c.id}>
                           <td className="border border-black text-center p-0 align-middle h-4">
                             {selected 
                               ? <span className="text-sm font-bold text-black leading-none">☑</span> 
                               : <span className="text-sm text-gray-300 leading-none">☐</span>
                             }
                           </td>
                           <td className="border border-black text-center font-mono text-gray-600 text-[8px] align-middle">
                             {c.voter_no}
                           </td>
                           <td className={`border border-black px-2 align-middle truncate ${selected ? 'font-bold bg-gray-100' : ''}`}>
                             {c.name}
                           </td>
                         </tr>
                       )
                     })}
                   </tbody>
                 </table>
               </div>
             )
          })}
        </div>
        
        <div className="mt-4 text-[8px] text-gray-300 text-center w-full print:hidden">
           End of Record
        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          html, body { height: 100%; margin: 0 !important; padding: 0 !important; overflow: hidden; }
          body { background: white; -webkit-print-color-adjust: exact; }
          .avoid-break { break-inside: avoid; }
        }
      `}</style>
    </div>
  )
}