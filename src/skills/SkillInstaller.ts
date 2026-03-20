import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { Skill } from './SkillLoader';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

// ============================================================
// SkillInstaller — Handles dependency installation for skills
// ============================================================
// Features:
//   - Per-skill Python venv isolation (optional)
//   - pip install with --break-system-packages fallback
//   - npm install scoped to skill directory
//   - Caches installed state to avoid re-installing
//   - Timeout protection for dependency installation
// ============================================================

const INSTALL_TIMEOUT_MS = 120_000; // 2 min for dependency install

interface InstallResult {
  success: boolean;
  installed: string[];
  failed: string[];
  messages: string[];
}

export class SkillInstaller {

  /**
   * Install all dependencies for a skill
   */
  async install(skill: Skill): Promise<InstallResult> {
    const result: InstallResult = {
      success: true,
      installed: [],
      failed: [],
      messages: [],
    };

    if (!skill.dependencies) {
      result.messages.push('No dependencies to install');
      return result;
    }

    // Install pip packages
    if (skill.dependencies.pip && skill.dependencies.pip.length > 0) {
      const pipResult = await this.installPip(skill.dependencies.pip, skill.dirPath);
      result.installed.push(...pipResult.installed);
      result.failed.push(...pipResult.failed);
      result.messages.push(...pipResult.messages);
      if (!pipResult.success) result.success = false;
    }

    // Install npm packages
    if (skill.dependencies.npm && skill.dependencies.npm.length > 0) {
      const npmResult = await this.installNpm(skill.dependencies.npm, skill.dirPath);
      result.installed.push(...npmResult.installed);
      result.failed.push(...npmResult.failed);
      result.messages.push(...npmResult.messages);
      if (!npmResult.success) result.success = false;
    }

    // Mark as installed
    if (result.success) {
      this.markInstalled(skill.dirPath, skill.dependencies);
    }

    return result;
  }

  /**
   * Check if dependencies are already installed
   */
  isInstalled(skillDir: string): boolean {
    const marker = path.join(skillDir, '.deps-installed');
    return fs.existsSync(marker);
  }

  /**
   * Install Python packages via pip
   */
  private async installPip(packages: string[], skillDir: string): Promise<InstallResult> {
    const result: InstallResult = { success: true, installed: [], failed: [], messages: [] };

    // Check if we should use a venv
    const venvPath = path.join(skillDir, '.venv');
    const useVenv = await this.ensureVenv(venvPath);

    const pipCmd = useVenv
      ? `${venvPath}/bin/pip3`
      : 'pip3';

    const breakFlag = useVenv ? '' : '--break-system-packages';

    for (const pkg of packages) {
      const pkgName = pkg.split(/[><=~!]/)[0].trim();
      try {
        logger.info(`[SkillInstaller] Installing pip: ${pkg}`);
        const cmd = `${pipCmd} install "${pkg}" ${breakFlag} --quiet 2>&1`;
        await execAsync(cmd, { timeout: INSTALL_TIMEOUT_MS, cwd: skillDir });
        result.installed.push(pkg);
        result.messages.push(`✅ pip: ${pkg} installed`);
      } catch (err: any) {
        // Try without --break-system-packages as fallback
        if (breakFlag) {
          try {
            await execAsync(`${pipCmd} install "${pkg}" --quiet 2>&1`, {
              timeout: INSTALL_TIMEOUT_MS,
              cwd: skillDir,
            });
            result.installed.push(pkg);
            result.messages.push(`✅ pip: ${pkg} installed (fallback)`);
            continue;
          } catch { /* fallthrough */ }
        }

        result.failed.push(pkg);
        result.success = false;
        const stderr = err.stderr?.substring(0, 300) || err.message;
        result.messages.push(`❌ pip: ${pkg} failed — ${stderr}`);
        logger.error(`[SkillInstaller] Failed to install ${pkg}: ${stderr}`);
      }
    }

    if (useVenv) {
      result.messages.push(`🐍 Using venv: ${venvPath}`);
    }

    return result;
  }

  /**
   * Install Node.js packages via npm
   */
  private async installNpm(packages: string[], skillDir: string): Promise<InstallResult> {
    const result: InstallResult = { success: true, installed: [], failed: [], messages: [] };

    // Initialize package.json if needed
    const pkgJson = path.join(skillDir, 'package.json');
    if (!fs.existsSync(pkgJson)) {
      fs.writeFileSync(pkgJson, JSON.stringify({
        name: path.basename(skillDir),
        version: '1.0.0',
        private: true,
      }, null, 2), 'utf-8');
    }

    try {
      const cmd = `npm install ${packages.join(' ')} --save --silent 2>&1`;
      logger.info(`[SkillInstaller] Installing npm: ${packages.join(', ')}`);
      await execAsync(cmd, { timeout: INSTALL_TIMEOUT_MS, cwd: skillDir });
      result.installed.push(...packages);
      result.messages.push(`✅ npm: ${packages.join(', ')} installed`);
    } catch (err: any) {
      result.failed.push(...packages);
      result.success = false;
      const stderr = err.stderr?.substring(0, 300) || err.message;
      result.messages.push(`❌ npm: installation failed — ${stderr}`);
      logger.error(`[SkillInstaller] npm install failed: ${stderr}`);
    }

    return result;
  }

  /**
   * Ensure a Python venv exists for isolation
   */
  private async ensureVenv(venvPath: string): Promise<boolean> {
    // Check if venv already exists
    if (fs.existsSync(path.join(venvPath, 'bin', 'pip3'))) {
      return true;
    }

    try {
      await execAsync(`python3 -m venv "${venvPath}"`, { timeout: 30_000 });
      logger.info(`[SkillInstaller] Created venv at ${venvPath}`);
      return true;
    } catch (err) {
      // Venv creation failed — fall back to system pip
      logger.warn(`[SkillInstaller] Failed to create venv (using system pip): ${err}`);
      return false;
    }
  }

  /**
   * Mark dependencies as installed
   */
  private markInstalled(skillDir: string, deps: Skill['dependencies']): void {
    const marker = path.join(skillDir, '.deps-installed');
    fs.writeFileSync(marker, JSON.stringify({
      timestamp: new Date().toISOString(),
      dependencies: deps,
    }, null, 2), 'utf-8');
  }

  /**
   * Get the Python executable for a skill (venv or system)
   */
  getPythonPath(skillDir: string): string {
    const venvPython = path.join(skillDir, '.venv', 'bin', 'python3');
    if (fs.existsSync(venvPython)) return venvPython;
    return 'python3';
  }

  /**
   * Get the Node executable for a skill
   */
  getNodePath(_skillDir: string): string {
    return 'node';
  }
}
