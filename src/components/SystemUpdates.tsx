import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpCircle, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { api, ApiError, message } from '../api';
import type { SystemUpdateStatus, UpdateJob } from '../types';
import { PROJECT_GITHUB_URL, PROJECT_REPOSITORY } from '../project';
import { MacButton, useNotify } from './ui';
import { ConfirmDialog } from './ConfirmDialog';
import { currentFeedbackVisit, useViewFeedback } from '../viewFeedback';
import './system-updates.css';

const running = (job?: UpdateJob | null) => !!job && ['queued', 'pulling', 'backing_up', 'replacing', 'starting', 'verifying', 'rolling_back'].includes(job.stage);
const ReleaseNotes = lazy(() => import('./ReleaseNotes'));

export function SystemUpdates({ active }: { active: boolean }) {
  const notify = useNotify();
  const [status, setStatus] = useState<SystemUpdateStatus>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useViewFeedback<UpdateJob | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [bundle, setBundle] = useState<File | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const [starting, setStarting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [watch, setWatch] = useState(false);
  const [revision, setRevision] = useState(0);
  const lastJob = useRef<UpdateJob | null>(null);
  const lastJobVisit = useRef(0);
  const checkController = useRef<AbortController | null>(null);
  const visit = useRef(0);
  const busy = starting || checking || running(status?.updater.job) || watch;

  function accept(result: SystemUpdateStatus) {
    if (!result.updater.job && running(lastJob.current)) result = { ...result, updater: { ...result.updater, job: lastJob.current } };
    const receivedJob = result.updater.job;
    if (receivedJob && ['succeeded', 'failed', 'rolled_back'].includes(receivedJob.stage)) {
      if (lastJobVisit.current === currentFeedbackVisit() && running(lastJob.current) && lastJob.current?.id === receivedJob.id) setOutcome(receivedJob);
      result = { ...result, updater: { ...result.updater, job: null } };
    } else if (receivedJob) setOutcome(null);
    lastJob.current = result.updater.job;
    lastJobVisit.current = currentFeedbackVisit();
    setStatus(result); setError(''); setReconnecting(false);
    if (!running(result.updater.job)) setWatch(false);
  }

  useLayoutEffect(() => {
    setOutcome(null); setWatch(false); setChecking(false); setReconnecting(false);
    lastJob.current = null;
    return () => { visit.current++; checkController.current?.abort(); };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const origin = visit.current;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try { const result = await api.systemUpdates(controller.signal); if (!controller.signal.aborted && visit.current === origin) accept(result); }
      catch (reason) { if (!controller.signal.aborted) { if (watch || running(lastJob.current)) setReconnecting(true); else setError(message(reason)); } }
      finally { if (!controller.signal.aborted && (watch || running(lastJob.current))) timer = setTimeout(load, 2000); }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, watch, revision, setOutcome]);

  async function check() {
    if (busy) return;
    const controller = new AbortController(); checkController.current = controller; setChecking(true);
    try {
      const result = await api.checkSystemUpdates(controller.signal);
      if (controller.signal.aborted) return;
      setOutcome(null); accept(result); notify(result.updateAvailable ? `发现新版本 v${result.latest!.version}` : '当前已是最新稳定版本');
    } catch (reason) { if (!controller.signal.aborted) notify(message(reason), 'error'); }
    finally { if (!controller.signal.aborted) setChecking(false); }
  }

  async function install() {
    if (!status || (!bundle && !status.latest) || busy) return;
    const origin = visit.current;
    setStarting(true); setOutcome(null);
    try {
      const job = bundle ? await api.uploadSystemUpdate(bundle) : await api.installSystemUpdate(status.latest!);
      if (visit.current !== origin) return;
      lastJobVisit.current = currentFeedbackVisit();
      lastJob.current = job; setStatus(previous => previous ? { ...previous, updater: { ...previous.updater, job } } : previous);
      setWatch(true); notify('升级已开始，服务重启时会自动重新连接');
    } catch (reason) {
      if (bundle && reason instanceof ApiError && reason.status >= 400 && reason.status < 500) {
        notify(message(reason), 'error');
        return;
      }
      // The server may have accepted the job before the connection was lost.
      // Re-read status before offering another install instead of replaying POST.
      if (visit.current === origin) { setWatch(true); setRevision(value => value + 1); notify(`${message(reason)}；正在重新确认升级状态`, 'error'); }
    } finally {
      setStarting(false); setConfirm(false); setBundle(null);
      if (visit.current !== origin) setRevision(value => value + 1);
    }
  }

  function selectBundle(file?: File) {
    if (!file || busy) return;
    if (!file.name.toLowerCase().endsWith('.tar.gz') || !file.size || file.size > 256 * 1024 * 1024) {
      notify('请选择非空且不超过 256 MiB 的 .tar.gz 网站安装包', 'error'); return;
    }
    setBundle(file); setConfirm(true);
  }

  const failure = active && outcome && outcome.stage !== 'succeeded' ? outcome : null;
  const job = status?.updater.job ?? (active && outcome?.stage === 'succeeded' ? outcome : null);
  const complete = job?.stage === 'succeeded' && status?.current.version === job.version;
  return <section className="system-updates" aria-label="系统更新详情">
    <div className="update-summary"><span className="update-symbol"><ArrowUpCircle size={32} /></span><div className="update-summary-copy"><div className="update-summary-heading"><h3>保持系统更新</h3><MacButton className="update-check" variant="secondary" disabled={!status?.configured || busy || job?.stage === 'interrupted'} onClick={() => void check()}><RefreshCw size={14} aria-hidden="true" className={checking ? 'update-spinner' : undefined} />{checking ? '正在检查…' : '检查更新'}</MacButton></div><p>更新网页界面与服务程序，保留账户、导航和上传资源。</p></div></div>
    <a className="update-repository" href={PROJECT_GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label={`在新标签页打开 GitHub 仓库 ${PROJECT_REPOSITORY}`}>
      <svg className="update-github-logo" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297C5.37.297 0 5.67 0 12.297c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.087-.744.083-.729.083-.729 1.205.084 1.838 1.237 1.838 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.467-1.332-5.467-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.301 1.23a11.52 11.52 0 0 1 3.003-.404c1.02.005 2.045.138 3.003.404 2.291-1.552 3.297-1.23 3.297-1.23.655 1.652.243 2.873.119 3.176.77.84 1.235 1.911 1.235 3.221 0 4.611-2.807 5.628-5.479 5.925.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
      <span className="update-repository-copy"><strong>GitHub 项目仓库</strong><span>{PROJECT_REPOSITORY}</span></span><ExternalLink className="update-repository-arrow" size={15} aria-hidden="true" />
    </a>
    {error && <div className="update-read-error" role="alert"><p>{error}</p><MacButton variant="secondary" onClick={() => setRevision(value => value + 1)}>重新读取</MacButton></div>}
    {!status && !error && <p role="status">正在读取版本信息…</p>}
    {status && <>
      <dl className="update-versions"><div><dt>当前版本</dt><dd>v{status.current.version}</dd></div><div><dt>最新稳定版</dt><dd>{status.latest ? `v${status.latest.version}` : '尚未检查'}</dd></div></dl>
      {!status.configured ? <p className="update-help">{status.configurationMessage || '发布源配置不完整，请检查发布仓库和镜像地址。'}</p> : !status.updater.available && <p className="update-help">{status.updater.message}。单容器部署请使用支持网页升级的镜像、默认启动命令和可写的 /data。</p>}
      {status.checkedAt && <p className="update-checked">上次检查：{new Date(status.checkedAt).toLocaleString()}</p>}
      {watch && !job && <p role="status">正在重新确认升级状态，请稍候…</p>}
      {job && <div className={`update-job update-job-${job.stage}`} role="status" aria-live="polite">
        {running(job) ? <LoaderCircle className="update-spinner" size={18} /> : complete ? <CheckCircle2 size={18} /> : <RefreshCw size={18} />}
        <div><strong>{job.message}</strong>{(reconnecting || job.version) && <p>{reconnecting ? '服务正在重启或暂时不可达，正在自动重新连接…' : `目标版本 v${job.version}`}</p>}{job.stage === 'interrupted' && <p>请在部署终端运行升级服务的恢复命令，备份会保留。</p>}</div>
      </div>}
      <div className="update-actions">
        {status.updateAvailable && <MacButton variant="primary" disabled={!status.updater.available || busy || job?.stage === 'interrupted'} onClick={() => setConfirm(true)}>{running(job) || starting ? '升级进行中…' : '在线升级'}</MacButton>}
        <MacButton variant="secondary" title={status.updater.localUpload ? undefined : '需要支持本地上传的单容器镜像启动器'} disabled={!status.updater.available || !status.updater.localUpload || busy || job?.stage === 'interrupted'} onClick={() => filePicker.current?.click()}>上传安装包升级</MacButton>
        <input ref={filePicker} hidden type="file" accept=".tar.gz" aria-label="选择网站安装包" onChange={event => { selectBundle(event.target.files?.[0]); event.target.value = ''; }} />
        {complete && <MacButton variant="primary" onClick={() => window.location.reload()}>刷新使用新版本</MacButton>}
      </div>
      {failure && <div className="update-failure" role="alert"><strong>升级失败</strong><p>{failure.message}</p>{failure.version && <small>目标版本 v{failure.version}</small>}</div>}
      {status.latest && <details className="update-release" onToggle={event => setNotesOpen(event.currentTarget.open)}>
        <summary>v{status.latest.version} 更新说明</summary>
        {notesOpen && (status.latest.notes.trim() ? <Suspense fallback={<p role="status">正在加载更新说明…</p>}>
          <ReleaseNotes notes={status.latest.notes} releaseUrl={status.latest.url} />
        </Suspense> : <p>此版本未提供更新说明。</p>)}
        <a href={status.latest.url} target="_blank" rel="noopener noreferrer">查看版本发布页</a>
      </details>}
      <p className="update-help">安装前会短暂停止服务并备份数据。新版本启动检查失败时自动恢复上一版本。请在开始前保存正在编辑的内容。</p>
    </>}
    {confirm && (bundle || status?.latest) && <ConfirmDialog title={bundle ? '安装所选升级包？' : `升级到 v${status?.latest?.version}？`} description={bundle
      ? `将上传并安装 ${bundle.name}（${(bundle.size / 1024 / 1024).toFixed(1)} MiB）。请在上传期间保持页面打开，安装前会自动备份数据。`
      : '将更新整套系统。下载完成后会暂停服务、备份数据并重启；窗口可以关闭，升级会继续在后台进行。'} confirmLabel={bundle ? '上传并升级' : '备份并升级'} busyLabel={bundle ? '正在上传…' : '正在创建升级任务…'} onClose={() => { setConfirm(false); setBundle(null); }} onConfirm={install} />}
  </section>;
}
