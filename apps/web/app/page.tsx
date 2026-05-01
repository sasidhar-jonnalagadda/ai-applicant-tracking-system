'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { 
  UploadCloud, 
  Search, 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  Briefcase, 
  User, 
  Mail, 
  ExternalLink,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  PlusCircle,
  X,
  Trash2
} from 'lucide-react';
import axios from 'axios';
import type { ICandidateDTO, IJobPosting } from '@repo/shared';
import { JobStatus } from '@repo/shared';
import { env } from './env';

/**
 * PRODUCTION-GRADE RECRUITER DASHBOARD
 */
export default function Home() {
  // --- State Management ---
  const [jobs, setJobs] = useState<IJobPosting[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'processing' | 'done' | 'error'>('idle');
  const [uploadCount, setUploadCount] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<ICandidateDTO[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [expandedCandidateIds, setExpandedCandidateIds] = useState<Set<string>>(new Set());
  const [isDelayed, setIsDelayed] = useState(false);
  
  // Job Creation Modal State
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [isCreatingJob, setIsCreatingJob] = useState(false);
  const [newJob, setNewJob] = useState({
    title: '',
    department: '',
    description: '',
    requirements: ''
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const API_URL = env.NEXT_PUBLIC_API_URL;

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // --- Initial Data Fetching ---
  const loadJobs = useCallback(async () => {
    try {
      const res = await axios.get<IJobPosting[]>(`${API_URL}/api/jobs`);
      setJobs(res.data);
      
      const firstJob = res.data[0];
      if (firstJob && !selectedJobId) {
        setSelectedJobId(String(firstJob._id));
      }
    } catch (error) {
      console.error('Failed to load jobs:', error instanceof Error ? error.message : 'Unknown error');
    }
  }, [API_URL, selectedJobId]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // --- Logic: Create Dynamic Job ---
  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJob.title || !newJob.department) {
      return;
    }

    setIsCreatingJob(true);
    try {
      const payload = {
        ...newJob,
        requirements: newJob.requirements.split(',').map(s => s.trim()).filter(s => s.length > 0)
      };

      const res = await axios.post<IJobPosting>(`${API_URL}/api/jobs`, payload);
      
      await loadJobs();
      setSelectedJobId(String(res.data._id));
      setIsJobModalOpen(false);
      setNewJob({ title: '', department: '', description: '', requirements: '' });
      setErrorMessage('');
    } catch (error) {
      console.error('Failed to create job:', error instanceof Error ? error.message : 'Unknown error');
      alert('Failed to create job role. Check server connection.');
    } finally {
      setIsCreatingJob(false);
    }
  };

  // --- Logic: Delete Job Role ---
  const handleDeleteJob = async () => {
    if (!selectedJobId) return;

    const jobTitle = jobs.find(j => String(j._id) === selectedJobId)?.title || 'this role';
    const confirmMessage = `Are you sure you want to delete "${jobTitle}"?\n\nThis will remove the job context and disconnect all associated candidate analysis. This action cannot be undone.`;

    if (!window.confirm(confirmMessage)) return;

    try {
      await axios.delete(`${API_URL}/api/jobs/${selectedJobId}`);
      await loadJobs();
      setSelectedJobId('');
    } catch (error) {
      console.error('Delete failed:', error instanceof Error ? error.message : 'Unknown error');
      alert('Failed to delete job role. Please try again.');
    }
  };

  // --- Logic: Resume Ingestion & Polling ---
  const handleUpload = async (files: File[]) => {
    if (!selectedJobId) {
      setUploadStatus('error');
      setErrorMessage('Please select or create a Job Posting context first.');
      return;
    }

    if (files.length === 0) {
      return;
    }
    if (files.length > 50) {
      setUploadStatus('error');
      setErrorMessage('Maximum of 50 files allowed per upload.');
      return;
    }

    setErrorMessage('');
    setUploadStatus('uploading');
    setUploadCount(files.length);
    setIsDelayed(false);

    // Clear any existing polling interval from a previous upload
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    
    try {
      const formData = new FormData();
      formData.append('jobPostingId', selectedJobId);
      files.forEach(file => formData.append('resumes', file));

      const res = await axios.post<{ taskIds: string[] }>(`${API_URL}/api/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const taskIds = res.data.taskIds;
      setUploadStatus('processing');

      let pollCount = 0;
      const MAX_POLLS = 60; // Safety cap: 60 polls × 3s = 3 minutes max

      // Poll for all tasks to complete
      pollingIntervalRef.current = setInterval(async () => {
        pollCount++;
        if (pollCount > 10) {
          setIsDelayed(true);
        }

        // Safety timeout — abort polling after MAX_POLLS to prevent infinite loops
        if (pollCount >= MAX_POLLS) {
          setUploadStatus('error');
          setErrorMessage('Processing timed out. Tasks may still complete in the background.');
          clearInterval(pollingIntervalRef.current!);
          pollingIntervalRef.current = null;
          return;
        }

        try {
          // Check all tasks concurrently
          const taskPromises = taskIds.map(taskId => 
            axios.get<{ status: string; error?: string }>(`${API_URL}/api/jobs/tasks/${taskId}`)
          );
          
          const taskResponses = await Promise.all(taskPromises);
          const allCompleted = taskResponses.every(res => res.data.status === JobStatus.COMPLETED);
          const anyFailed = taskResponses.find(res => res.data.status === JobStatus.FAILED);
          
          if (anyFailed) {
            setUploadStatus('error');
            setErrorMessage(anyFailed.data.error || 'AI Processing failed for one or more resumes.');
            clearInterval(pollingIntervalRef.current!);
            pollingIntervalRef.current = null;
          } else if (allCompleted) {
            setUploadStatus('done');
            clearInterval(pollingIntervalRef.current!);
            pollingIntervalRef.current = null;
            if (query) {
              handleSearch();
            }
          }
        } catch (e) {
          console.error('Polling error:', e instanceof Error ? e.message : 'Unknown error');
        }
      }, 3000);

    } catch (error) {
      console.error('Upload failed:', error instanceof Error ? error.message : 'Unknown error');
      setUploadStatus('error');
      setErrorMessage('Upload failed. Check file size or network.');
    }
  };

  // --- Logic: Semantic Search ---
  const handleSearch = async () => {
    if (!query) {
      return;
    }
    setIsSearching(true);
    try {
      const res = await axios.post<ICandidateDTO[]>(`${API_URL}/api/candidates/search`, {
        query,
        jobPostingId: selectedJobId || undefined
      });
      setCandidates(res.data);
      setExpandedCandidateIds(new Set()); // Reset expansions on new search
    } catch (error) {
      console.error('Search failed:', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsSearching(false);
    }
  };

  const toggleExpandCandidate = (id: string) => {
    setExpandedCandidateIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // --- Drag and Drop Handlers ---
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    const pdfFiles = files.filter(f => f.type === 'application/pdf');
    
    if (pdfFiles.length > 0) {
      handleUpload(pdfFiles);
    } else {
      setUploadStatus('error');
      setErrorMessage('Invalid file type. Please drop standard PDFs.');
    }
  };

  return (
    <main className="min-h-screen bg-surface-50 text-surface-900 p-4 md:p-8 selection:bg-brand-100 animate-fade-in-up relative">
      <div className="max-w-6xl mx-auto space-y-10">
        
        {/* --- Header Section --- */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-8 border-b border-surface-200">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-brand-500 text-white p-1.5 rounded-lg">
                <Briefcase size={20} />
              </span>
            </div>
            <h1 className="text-4xl font-black tracking-tight text-surface-900">
              Recruiter <span className="text-brand-500">Dashboard</span>
            </h1>
            <p className="text-surface-500 mt-1 font-medium">Precision AI Ingestion & Semantic Matching</p>
          </div>

          {/* Job Selection Context */}
          <div className="w-full md:w-80 space-y-1.5">
            <div className="flex justify-between items-center px-1">
              <span className="text-xs font-bold text-surface-400 uppercase tracking-wider">Active Job Context</span>
              <button 
                type="button"
                onClick={() => setIsJobModalOpen(true)}
                className="text-[10px] font-black text-brand-600 hover:text-brand-700 flex items-center gap-1 uppercase tracking-tighter cursor-pointer"
              >
                <PlusCircle size={12} /> Create New Job Role
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <select 
                  value={selectedJobId}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                  className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3 appearance-none focus:ring-2 focus:ring-brand-500 outline-none shadow-sm font-semibold text-surface-700 disabled:opacity-50"
                >
                  {jobs.length === 0 && <option value="">No jobs available</option>}
                  {jobs.map(job => (
                    <option key={String(job._id)} value={String(job._id)}>{job.title}</option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-surface-400">
                  <ChevronRight size={18} className="rotate-90" />
                </div>
              </div>
              <button
                type="button"
                onClick={handleDeleteJob}
                disabled={!selectedJobId}
                title="Delete active job role"
                className="w-12 h-12 flex items-center justify-center bg-white border border-surface-200 rounded-xl text-surface-400 hover:text-accent-error hover:border-accent-error/30 hover:bg-accent-error/5 transition-all shadow-sm disabled:opacity-30 disabled:cursor-not-allowed group"
              >
                <Trash2 size={20} className="group-hover:scale-110 transition-transform" />
              </button>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* --- Sidebar: Ingestion --- */}
          <aside className="lg:col-span-4 space-y-6">
            <section className="glass p-6 rounded-3xl border border-white/40 shadow-xl space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold flex items-center gap-2 text-surface-800">
                  <UploadCloud className="text-brand-500" size={22}/> Ingest Candidate
                </h2>
              </div>

              <div
                role="button"
                tabIndex={0}
                className={`group border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-300 relative overflow-hidden ${
                  isDragging 
                    ? 'border-brand-500 bg-brand-50/50 scale-[0.98]' 
                    : 'border-surface-200 hover:border-brand-400 hover:bg-brand-50/30'
                }`}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="application/pdf"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) {
                      handleUpload(files);
                    }
                  }}
                />
                <div className="relative z-10 pointer-events-none">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 transition-transform ${
                    isDragging ? 'bg-brand-500 text-white scale-110' : 'bg-brand-50 text-brand-600 group-hover:scale-110'
                  }`}>
                    <UploadCloud size={24} />
                  </div>
                  <p className="text-surface-700 font-bold">
                    {isDragging ? 'Release to Upload' : 'Drop resume here'}
                  </p>
                  <p className="text-xs text-surface-400 mt-1 font-medium italic">Standard PDF • Max 5MB</p>
                </div>
              </div>

              {uploadStatus !== 'idle' && (
                <div className={`flex items-center gap-4 p-4 rounded-2xl border transition-all animate-fade-in-up ${
                  uploadStatus === 'error' ? 'bg-accent-error/10 border-accent-error/20' : 'bg-surface-50 border-surface-200'
                }`}>
                  <div className="flex-shrink-0">
                    {uploadStatus === 'uploading' && <Clock className="animate-spin text-brand-500"/>}
                    {uploadStatus === 'processing' && <div className="w-5 h-5 bg-brand-500 rounded-full animate-pulse" />}
                    {uploadStatus === 'done' && <CheckCircle className="text-accent-success"/>}
                    {uploadStatus === 'error' && <AlertCircle className="text-accent-error"/>}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-surface-800 capitalize">
                      {uploadStatus === 'processing' ? `Analyzing ${uploadCount} resume${uploadCount > 1 ? 's' : ''} via Gemini 2.5 Flash` : uploadStatus}
                    </p>
                    <p className="text-xs text-surface-400 font-medium">
                      {uploadStatus === 'error' ? (errorMessage || 'Check job context') : (uploadStatus === 'processing' ? 'Extracting structured data in parallel...' : 'System status updated')}
                    </p>
                  </div>
                </div>
              )}

              {/* Graceful 'Busy Server' Warning */}
              {isDelayed && uploadStatus === 'processing' && (
                <div className="flex items-center gap-4 p-4 bg-accent-warning/10 border border-accent-warning/20 rounded-2xl animate-fade-in-up">
                  <div className="flex-shrink-0">
                    <AlertCircle className="text-accent-warning" size={20} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-accent-warning uppercase tracking-widest leading-none mb-1">Busy Processing</p>
                    <p className="text-[11px] font-semibold text-accent-warning/80 leading-relaxed">
                      Google's AI servers are experiencing high traffic. Your resumes are safely queued and will finish automatically. You can safely leave this page open.
                    </p>
                  </div>
                </div>
              )}
            </section>

            <div className="p-6 bg-surface-900 rounded-3xl text-white space-y-4 shadow-2xl">
              <h3 className="text-sm font-bold uppercase tracking-widest text-surface-400">Pipeline Health</h3>
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-3xl font-black">{candidates.length}</p>
                  <p className="text-xs text-surface-400 font-bold">Matched Candidates</p>
                </div>
                <div className="h-10 w-24 bg-brand-500/20 rounded-lg relative overflow-hidden">
                   <div className="absolute inset-0 bg-brand-500/40 animate-shimmer" style={{ width: '40%' }}></div>
                </div>
              </div>
            </div>
          </aside>

          {/* --- Main Area: Search & Results --- */}
          <section className="lg:col-span-8 space-y-6">
            <div className="glass p-2 rounded-2xl shadow-lg border border-white/40 flex items-center gap-2 group">
              <div className="pl-4 text-surface-400 group-focus-within:text-brand-500 transition-colors">
                <Search size={22} />
              </div>
              <input
                type="text"
                className="flex-1 bg-transparent border-none px-2 py-4 focus:outline-none font-semibold text-lg text-surface-800 placeholder:text-surface-300"
                placeholder="Search candidates by experience, skill, or role..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <button
                type="button"
                onClick={handleSearch}
                disabled={isSearching || !query}
                className="bg-surface-900 hover:bg-black text-white px-8 py-3 rounded-xl font-bold transition-all disabled:opacity-50 active:scale-95 shadow-lg"
              >
                {isSearching ? 'Analyzing...' : 'Search'}
              </button>
            </div>

            <div className="space-y-5">
              {isSearching ? (
                [1, 2, 3].map(i => (
                  <div key={i} className="bg-white p-8 rounded-3xl border border-surface-100 shadow-sm space-y-4 overflow-hidden relative">
                    <div className="h-6 w-1/3 bg-surface-100 rounded-lg animate-pulse" />
                    <div className="h-4 w-1/2 bg-surface-50 rounded-lg animate-pulse" />
                    <div className="h-20 w-full bg-surface-50 rounded-lg animate-pulse" />
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-shimmer" />
                  </div>
                ))
              ) : (
                candidates.map((candidate, index) => (
                  <div 
                    key={String(candidate._id)} 
                    className="group bg-white p-8 rounded-3xl border border-surface-100 shadow-sm hover:shadow-xl hover:border-brand-100 transition-all duration-500 animate-fade-in-up"
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex gap-4">
                        <div className="w-14 h-14 bg-surface-50 rounded-2xl flex items-center justify-center text-surface-400 group-hover:bg-brand-50 group-hover:text-brand-500 transition-colors">
                          <User size={28} />
                        </div>
                        <div>
                          <h3 className="text-xl font-black text-surface-900 leading-tight">{candidate.personalInfo.fullName}</h3>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="flex items-center gap-1 text-sm font-bold text-surface-400 uppercase tracking-tight">
                              <Mail size={14} /> {candidate.personalInfo.email}
                            </span>
                            <span className="text-surface-200">•</span>
                            <span className="text-sm font-black text-brand-600">{candidate.totalYearsExperience}Y Experience</span>
                          </div>
                        </div>
                      </div>
                      
                      {candidate.score !== undefined && (
                        <div className="flex flex-col items-end">
                          <div className="bg-accent-success/10 text-accent-success px-4 py-1.5 rounded-full text-sm font-black border border-accent-success/20">
                            {Math.round(candidate.score * 100)}% Match
                          </div>
                          <p className="text-[10px] font-bold text-surface-300 uppercase tracking-tighter mt-1">Semantic Score</p>
                        </div>
                      )}
                    </div>

                    <p className="mt-6 text-surface-600 leading-relaxed font-medium">
                      {candidate.summary}
                    </p>

                    <div className="mt-6 pt-6 border-t border-surface-50 flex flex-wrap gap-2">
                      {candidate.skills.slice(0, 12).map((skill, idx) => (
                        <span 
                          key={idx} 
                          className="bg-surface-50 text-surface-500 group-hover:bg-brand-50 group-hover:text-brand-600 border border-transparent group-hover:border-brand-100 px-3 py-1.5 rounded-xl text-xs font-black transition-all"
                        >
                          {skill.name}
                        </span>
                      ))}
                    </div>

                    <div className="mt-6 flex gap-4">
                      <button 
                        type="button" 
                        onClick={() => toggleExpandCandidate(String(candidate._id))}
                        className="flex-1 bg-brand-50 hover:bg-brand-100 text-brand-600 px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                      >
                        {expandedCandidateIds.has(String(candidate._id)) ? (
                          <>Hide Analysis <ChevronUp size={16} /></>
                        ) : (
                          <>Expand Analysis <ChevronDown size={16} /></>
                        )}
                      </button>
                      <button type="button" className="flex-1 bg-surface-50 hover:bg-surface-100 text-surface-600 px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2">
                        View Resume <ExternalLink size={16} />
                      </button>
                    </div>

                    {/* --- Explainable AI Match Breakdown --- */}
                    {expandedCandidateIds.has(String(candidate._id)) && candidate.analysis && (
                      <div className="mt-6 pt-6 border-t border-surface-100 space-y-6 animate-fade-in-up">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-3">
                            <h4 className="text-xs font-black uppercase tracking-widest text-accent-success flex items-center gap-1.5">
                              <CheckCircle size={14} /> Key Strengths
                            </h4>
                            <ul className="space-y-2">
                              {candidate.analysis.pros.map((pro, i) => (
                                <li key={i} className="text-sm font-medium text-surface-600 flex items-start gap-2">
                                  <span className="text-accent-success mt-0.5">•</span>
                                  {pro}
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="space-y-3">
                            <h4 className="text-xs font-black uppercase tracking-widest text-accent-warning flex items-center gap-1.5">
                              <AlertCircle size={14} /> Gaps & Missing Skills
                            </h4>
                            <ul className="space-y-2">
                              {candidate.analysis.cons.map((con, i) => (
                                <li key={i} className="text-sm font-medium text-surface-600 flex items-start gap-2">
                                  <span className="text-accent-warning mt-0.5">•</span>
                                  {con}
                                </li>
                              ))}
                              {candidate.analysis.missingKeywords.map((kw, i) => (
                                <li key={`kw-${i}`} className="text-sm font-medium text-surface-600 flex items-start gap-2">
                                  <span className="text-accent-error mt-0.5">•</span>
                                  Missing keyword: <span className="font-bold">{kw}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <div className="bg-surface-50 p-5 rounded-2xl border border-surface-100">
                          <h4 className="text-xs font-black uppercase tracking-widest text-surface-500 mb-3 flex items-center gap-1.5">
                            <Briefcase size={14} /> Recommended Interview Questions
                          </h4>
                          <ul className="space-y-3">
                            {candidate.analysis.interviewQuestions.map((q, i) => (
                              <li key={i} className="text-sm font-bold text-surface-800">
                                {i + 1}. {q}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}

              {!isSearching && candidates.length === 0 && (
                <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-surface-100 animate-float">
                  <div className="w-20 h-20 bg-surface-50 rounded-full flex items-center justify-center mx-auto mb-4 text-surface-300">
                    <Search size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-surface-800">No candidates found</h3>
                  <p className="text-surface-400 font-medium max-w-xs mx-auto mt-2">
                    Try adjusting your search query or switching the job context above.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* --- Dynamic Job Creation Modal --- */}
      {isJobModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-900/60 backdrop-blur-md animate-fade-in">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl border border-surface-100 relative overflow-hidden animate-scale-in">
            <div className="absolute top-0 left-0 w-full h-2 bg-brand-500" />
            
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-2xl font-black text-surface-900">Create New Role</h2>
                <p className="text-sm font-medium text-surface-400">Define a new ingestion context</p>
              </div>
              <button 
                onClick={() => setIsJobModalOpen(false)}
                className="p-2 hover:bg-surface-50 rounded-full transition-colors text-surface-400 hover:text-surface-900"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleCreateJob} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-surface-400 uppercase tracking-widest pl-1">Job Title</label>
                  <input 
                    required
                    type="text" 
                    placeholder="e.g. Frontend Lead"
                    className="w-full bg-surface-50 border border-surface-200 rounded-2xl px-4 py-3.5 focus:ring-2 focus:ring-brand-500 outline-none font-bold text-surface-800 transition-all placeholder:text-surface-300"
                    value={newJob.title}
                    onChange={(e) => setNewJob({...newJob, title: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-surface-400 uppercase tracking-widest pl-1">Department</label>
                  <input 
                    required
                    type="text" 
                    placeholder="e.g. Engineering"
                    className="w-full bg-surface-50 border border-surface-200 rounded-2xl px-4 py-3.5 focus:ring-2 focus:ring-brand-500 outline-none font-bold text-surface-800 transition-all placeholder:text-surface-300"
                    value={newJob.department}
                    onChange={(e) => setNewJob({...newJob, department: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-black text-surface-400 uppercase tracking-widest pl-1">Role Description</label>
                <textarea 
                  rows={3}
                  placeholder="Provide a brief overview of the mission..."
                  className="w-full bg-surface-50 border border-surface-200 rounded-2xl px-4 py-3.5 focus:ring-2 focus:ring-brand-500 outline-none font-bold text-surface-800 transition-all placeholder:text-surface-300 resize-none"
                  value={newJob.description}
                  onChange={(e) => setNewJob({...newJob, description: e.target.value})}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-black text-surface-400 uppercase tracking-widest pl-1">Key Requirements (Comma Separated)</label>
                <input 
                  type="text" 
                  placeholder="React, TypeScript, GraphQL..."
                  className="w-full bg-surface-50 border border-surface-200 rounded-2xl px-4 py-3.5 focus:ring-2 focus:ring-brand-500 outline-none font-bold text-surface-800 transition-all placeholder:text-surface-300"
                  value={newJob.requirements}
                  onChange={(e) => setNewJob({...newJob, requirements: e.target.value})}
                />
              </div>

              <div className="pt-4 flex gap-4">
                <button 
                  type="button"
                  onClick={() => setIsJobModalOpen(false)}
                  className="flex-1 bg-surface-50 hover:bg-surface-100 text-surface-600 font-black py-4 rounded-2xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={isCreatingJob}
                  className="flex-[2] bg-surface-900 hover:bg-black text-white font-black py-4 rounded-2xl shadow-xl transition-all disabled:opacity-50 active:scale-95"
                >
                  {isCreatingJob ? 'Creating Role...' : 'Save Job Posting'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
