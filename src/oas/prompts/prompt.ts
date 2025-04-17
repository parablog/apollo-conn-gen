import colors from 'yoctocolors-cjs';

import {
  createPrompt,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isUpKey,
  KeypressEvent,
  makeTheme,
  Theme,
  type Status,
  useKeypress,
  useMemo,
  usePagination,
  usePrefix,
  useState,
} from '@inquirer/core';
import figures from '@inquirer/figures';
import type { PartialDeep } from '@inquirer/type';
import _ from 'lodash';

import { OasContext } from '../oasContext.js';
import { T, Composed, PropCircRef, CircularRef } from '../nodes/internal.js';
import { getMaxLength, isEscapeKey } from './base/utils.js';
import { CustomTheme, RenderContext } from './theme.js';
import { IType } from '../nodes/internal.js';

const baseTheme: CustomTheme = {
  prefix: {
    idle: colors.cyan('?'),
    done: colors.green(figures.tick),
    canceled: colors.red(figures.cross),
  },
  style: {
    disabled: (text: string) => colors.dim(text),
    active: (text: string) => colors.cyan(text),
    cancelText: (text: string) => colors.red(text),
    emptyText: (text: string) => colors.red(text),
    directory: (text: string) => colors.yellow(text),
    file: (text: string) => colors.white(text),
    currentDir: (text: string) => colors.magenta(text),
    message: (text: string, _status: Status) => colors.bold(text),
    help: (text: string) => colors.white(text),
    key: (text: string) => colors.cyan(text),
  },
  labels: {
    disabled: '(not allowed)',
  },
  hierarchySymbols: {
    branch: figures.lineUpDownRight + figures.line,
    leaf: figures.lineUpRight + figures.line,
  },
  renderItem(item: IType, context: RenderContext) {
    const isLast = context.index === context.items.length - 1;

    const linePrefix = isLast && !context.loop ? this.hierarchySymbols.leaf : this.hierarchySymbols.branch;

    const isLeaf = T.isLeaf(item);
    let line = !isLeaf
      ? `${item.forPrompt(context.context)} ${figures.triangleRight}`
      : `${item.forPrompt(context.context)}`;

    if (isLeaf) {
      line = context.selected.includes(item.path()) ? `${figures.radioOn} ${line}` : `${figures.radioOff} ${line}`;
    } else {
      line = `  ${line}`; // leave a space
    }

    line = `${linePrefix} ${line}`;

    const baseColor = !isLeaf ? this.style.directory : this.style.file;
    const color = context.isActive ? this.style.active : baseColor;

    const isDisabled = item instanceof PropCircRef || item instanceof CircularRef;
    return isDisabled ? this.style.disabled(`${line} ${this.labels.disabled}`) : color(line);
  },
};

interface PromptConfig {
  message: string;
  context: OasContext;
  types: IType[];
  pageSize?: number;
  loop?: boolean;
  allowCancel?: boolean;
  cancelText?: string;
  expandFn: (type?: IType) => IType[];
  theme?: PartialDeep<Theme<IPromptTheme>>;
}

const ANSI_HIDE_CURSOR = '\x1B[?25l';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface IPromptTheme {}

/*const isTypeLeaf = (type: IType): boolean => {
  return (
    type instanceof Scalar ||
    type instanceof PropScalar ||
    type instanceof En ||
    type instanceof CircularRef ||
    (type instanceof PropArray && type.items instanceof PropScalar)
  );
};*/

export const typesPrompt = createPrompt<string[] | [], PromptConfig>((config, done) => {
  const { pageSize = 40, loop = false, allowCancel = false, cancelText = 'Canceled.' } = config;

  const [status, setStatus] = useState<Status>('idle');
  const theme = makeTheme<CustomTheme>(baseTheme, config.theme);
  const prefix = usePrefix({ status, theme });

  const [current, setCurrent] = useState<IType>();
  const [selected, setSelected] = useState<string[]>([]);

  const items = useMemo(() => {
    // console.log('expanding', current);
    if (!current) {
      return config.types;
    }
    return config.expandFn(current!);
  }, [current]);

  const bounds = useMemo(() => {
    const first = 0; // items.findIndex(item => !item.isDisabled)
    const last = items.length - 1; // items.findLastIndex(item => !item.isDisabled)

    return { first, last };
  }, [items]);

  const [active, setActive] = useState(bounds.first);
  const activeItem: IType = items[active];

  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      setStatus('done');
      done(selected);
    } else if (isSelectKey(key)) {
      if (activeItem instanceof PropCircRef || activeItem instanceof CircularRef) {
        return;
      }

      if (selected.includes(activeItem.path())) {
        setSelected(selected.filter((path) => path !== activeItem.path()));
      } else {
        setSelected([...selected, activeItem.path()]);
      }
    } else if (isSelectAllKey(key)) {
      const children = current instanceof Composed ? current.props.values() : current!.children.values();

      const filtered =
        Array.from(children)
          .filter((child) => T.isLeaf(child) && !selected.includes(child.path()))
          .map((child) => child.path()) ?? [];

      setSelected([...selected, ...filtered]);
    } else if (isSelectNoneKey(key)) {
      const filtered =
        activeItem.parent?.children
          .filter((child) => T.isLeaf(child) && selected.includes(child.path()))
          .map((child) => child.path()) ?? [];

      setSelected(selected.filter((path) => !filtered.includes(path)));
    } else if (isDumpKey(key)) {
      if (current)
        console.info(T.print(current.ancestors()[0]))
    } else {
      const isLeaf = T.isLeaf(activeItem);

      if ((isSpaceKey(key) || isRightKey(key)) && !isLeaf) {
        setCurrent(activeItem);
        setActive(bounds.first);
      }
      // up and down
      else if (isUpKey(key) || isDownKey(key)) {
        rl.clearLine(0);
        if (loop || (isUpKey(key) && active !== bounds.first) || (isDownKey(key) && active !== bounds.last)) {
          const offset = isUpKey(key) ? -1 : 1;
          let next = active;
          next = (next + offset + items.length) % items.length;
          setActive(next);
        }
      } else if (isBackspaceKey(key) || isLeftKey(key)) {
        setCurrent(current?.parent);
        setActive(bounds.first);
      } else if (isEscapeKey(key) && allowCancel) {
        setStatus('canceled');
        done([]);
      }
    }
  });

  const page = usePagination({
    items,
    active,
    renderItem: ({ item, index, isActive }) =>
      theme.renderItem(item, { items, index, isActive, loop, selected, context: config.context }),
    pageSize,
    loop,
  });

  const message = theme.style.message(config.message, status);

  if (status === 'canceled') {
    return `${prefix} ${message} ${theme.style.cancelText(cancelText)}`;
  }

  if (status === 'done') {
    return `${prefix} ${message} ${theme.style.answer(activeItem.path())}`;
  }

  const header = _.replace(
    theme.style.currentDir(current?.path() ?? 'Get operations:'),
    />/g,
    ` ${figures.triangleRight} `,
  );

  const helpTip = useMemo(() => {
    const helpTipLines = [
      `${theme.style.key(figures.arrowUp + figures.arrowDown)} navigate, ${theme.style.key('<x>')} select field, ${theme.style.key('<a>')} select all fields, ${theme.style.key('<n>')} deselect all fields, ${theme.style.key('<enter>')} finish${allowCancel ? `, ${theme.style.key('<esc>')} cancel` : ''}`,
      `${theme.style.key('<space>')} expand type, ${theme.style.key('<backspace>')} go back`,
    ];

    const helpTipMaxLength = getMaxLength(helpTipLines);
    const delimiter = figures.lineBold.repeat(helpTipMaxLength);

    return `${delimiter}\n${helpTipLines.join('\n')}`;
  }, []);

  return `${prefix} ${message}\n${header}\n${!page.length ? theme.style.emptyText('emptyText') : page}\n${helpTip}${ANSI_HIDE_CURSOR}`;
});

const isLeftKey = (key: KeypressEvent): boolean =>
  // The left key
  key.name === 'left' ||
  // Vim keybinding
  key.name === 'j';

const isRightKey = (key: KeypressEvent): boolean =>
  // The right key
  key.name === 'right' ||
  // Vim keybinding
  key.name === 'l';

const isSelectKey = (key: KeypressEvent): boolean => key.name === 'x';

const isSelectAllKey = (key: KeypressEvent): boolean => key.name === 'a';

const isSelectNoneKey = (key: KeypressEvent): boolean => key.name === 'n';

const isDumpKey = (key: KeypressEvent): boolean => key.name === 'd';

const isInvertKey = (key: KeypressEvent): boolean => key.name === 'a';
