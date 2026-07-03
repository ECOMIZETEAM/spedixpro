'use client'
import { useState } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

// Selettore range date con calendario a comparsa.
// Props: dal, al (stringhe 'yyyy-mm-dd'), onChange(dal, al)
export default function DateRangePicker({ dal, al, onChange }: { dal: string, al: string, onChange: (dal: string, al: string) => void }) {
  const parse = (s: string) => s ? new Date(s + 'T00:00:00') : null
  const [startDate, setStartDate] = useState<Date | null>(parse(dal))
  const [endDate, setEndDate] = useState<Date | null>(parse(al))

  const fmt = (d: Date | null) => {
    if (!d) return ''
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), g = String(d.getDate()).padStart(2, '0')
    return y + '-' + m + '-' + g
  }

  function handleChange(dates: [Date | null, Date | null]) {
    const [start, end] = dates
    setStartDate(start)
    setEndDate(end)
    onChange(fmt(start), fmt(end))
  }

  return (
    <DatePicker
      selectsRange
      startDate={startDate}
      endDate={endDate}
      onChange={handleChange}
      dateFormat="dd/MM/yyyy"
      isClearable
      placeholderText="Seleziona intervallo date"
      className="daterange-input"
    />
  )
}