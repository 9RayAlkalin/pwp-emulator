/** Recover one interrupted request without retrying a missing or invalid HTTP resource. */
export async function downloadPack(url: string, filename: string, progress: (text: string) => void): Promise<File> {
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    progress(`${attempt ? '重新读取' : '正在读取'}曲包 ${filename}`);
    let response: Response;
    try { response = await fetch(url, { cache: attempt ? 'reload' : 'default' }); }
    catch (error) { failure = error; continue; }
    if (!response.ok) throw new Error(`无法读取曲包 ${filename}（HTTP ${response.status}）`);
    try {
      const blob = await response.blob();
      const length = response.headers.get('content-length');
      if (!blob.size || length !== null && !response.headers.get('content-encoding') && blob.size !== Number(length)) {
        failure = new Error('曲包响应不完整'); continue;
      }
      return new File([blob], filename, { type: 'application/zip' });
    } catch (error) { failure = error; }
  }
  throw new Error(`曲包下载中断：${filename}。${failure instanceof Error ? failure.message : String(failure)}`);
}
