import { some } from "lodash";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import * as React from "react";
import createAndInsertLink from "@shared/editor/commands/createAndInsertLink";
import filterExcessSeparators from "@shared/editor/lib/filterExcessSeparators";
import getColumnIndex from "@shared/editor/queries/getColumnIndex";
import getMarkRange from "@shared/editor/queries/getMarkRange";
import getRowIndex from "@shared/editor/queries/getRowIndex";
import isMarkActive from "@shared/editor/queries/isMarkActive";
import isNodeActive from "@shared/editor/queries/isNodeActive";
import { MenuItem } from "@shared/editor/types";
import { creatingUrlPrefix } from "@shared/utils/urls";
import useDictionary from "~/hooks/useDictionary";
import usePrevious from "~/hooks/usePrevious";
import useToasts from "~/hooks/useToasts";
import getDividerMenuItems from "../menus/divider";
import getFormattingMenuItems from "../menus/formatting";
import getImageMenuItems from "../menus/image";
import getTableMenuItems from "../menus/table";
import getTableColMenuItems from "../menus/tableCol";
import getTableRowMenuItems from "../menus/tableRow";
import { useEditor } from "./EditorContext";
import FloatingToolbar from "./FloatingToolbar";
import LinkEditor, { SearchResult } from "./LinkEditor";
import ToolbarMenu from "./ToolbarMenu";

type Props = {
  rtl: boolean;
  isTemplate: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSearchLink?: (term: string) => Promise<SearchResult[]>;
  onClickLink: (
    href: string,
    event: MouseEvent | React.MouseEvent<HTMLButtonElement>
  ) => void;
  onCreateLink?: (title: string) => Promise<string>;
};

function useIsActive(state: EditorState) {
  const { selection, doc } = state;

  if (isMarkActive(state.schema.marks.link)(state)) {
    return true;
  }
  if (!selection || selection.empty) {
    return false;
  }
  if (selection instanceof NodeSelection && selection.node.type.name === "hr") {
    return true;
  }
  if (
    selection instanceof NodeSelection &&
    selection.node.type.name === "image"
  ) {
    return true;
  }
  if (selection instanceof NodeSelection) {
    return false;
  }

  const selectionText = doc.cut(selection.from, selection.to).textContent;
  if (selection instanceof TextSelection && !selectionText) {
    return false;
  }

  const slice = selection.content();
  const fragment = slice.content;
  const nodes = (fragment as any).content;

  return some(nodes, (n) => n.content.size);
}

export default function SelectionToolbar(props: Props) {
  const { onClose, onOpen } = props;
  const { view, commands } = useEditor();
  const { showToast: onShowToast } = useToasts();
  const dictionary = useDictionary();
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const isActive = useIsActive(view.state);
  const previousIsActuve = usePrevious(isActive);

  React.useEffect(() => {
    // Trigger callbacks when the toolbar is opened or closed
    if (previousIsActuve && !isActive) {
      onClose();
    }
    if (!previousIsActuve && isActive) {
      onOpen();
    }
  }, [isActive, onClose, onOpen, previousIsActuve]);

  React.useEffect(() => {
    const handleClickOutside = (ev: MouseEvent): void => {
      if (
        ev.target instanceof HTMLElement &&
        menuRef.current &&
        menuRef.current.contains(ev.target)
      ) {
        return;
      }

      if (!isActive || document.activeElement?.tagName === "INPUT") {
        return;
      }

      if (view.hasFocus()) {
        return;
      }

      const { dispatch } = view;
      dispatch(
        view.state.tr.setSelection(new TextSelection(view.state.doc.resolve(0)))
      );
    };

    window.addEventListener("mouseup", handleClickOutside);

    return () => {
      window.removeEventListener("mouseup", handleClickOutside);
    };
  }, [isActive, view]);

  const handleOnCreateLink = async (title: string): Promise<void> => {
    const { onCreateLink } = props;

    if (!onCreateLink) {
      return;
    }

    const { dispatch, state } = view;
    const { from, to } = state.selection;
    if (from === to) {
      // selection cannot be collapsed
      return;
    }

    const href = `${creatingUrlPrefix}${title}…`;
    const markType = state.schema.marks.link;

    // Insert a placeholder link
    dispatch(
      view.state.tr
        .removeMark(from, to, markType)
        .addMark(from, to, markType.create({ href }))
    );

    createAndInsertLink(view, title, href, {
      onCreateLink,
      onShowToast,
      dictionary,
    });
  };

  const handleOnSelectLink = ({
    href,
    from,
    to,
  }: {
    href: string;
    from: number;
    to: number;
  }): void => {
    const { state, dispatch } = view;

    const markType = state.schema.marks.link;

    dispatch(
      state.tr
        .removeMark(from, to, markType)
        .addMark(from, to, markType.create({ href }))
    );
  };

  const { onCreateLink, isTemplate, rtl, ...rest } = props;
  const { state } = view;
  const { selection }: { selection: any } = state;
  const isCodeSelection = isNodeActive(state.schema.nodes.code_block)(state);
  const isDividerSelection = isNodeActive(state.schema.nodes.hr)(state);

  // toolbar is disabled in code blocks, no bold / italic etc
  if (isCodeSelection) {
    return null;
  }

  const colIndex = getColumnIndex(
    (state.selection as unknown) as CellSelection
  );
  const rowIndex = getRowIndex((state.selection as unknown) as CellSelection);
  const isTableSelection = colIndex !== undefined && rowIndex !== undefined;
  const link = isMarkActive(state.schema.marks.link)(state);
  const range = getMarkRange(selection.$from, state.schema.marks.link);
  const isImageSelection = selection.node?.type?.name === "image";

  let items: MenuItem[] = [];
  if (isTableSelection) {
    items = getTableMenuItems(dictionary);
  } else if (colIndex !== undefined) {
    items = getTableColMenuItems(state, colIndex, rtl, dictionary);
  } else if (rowIndex !== undefined) {
    items = getTableRowMenuItems(state, rowIndex, dictionary);
  } else if (isImageSelection) {
    items = getImageMenuItems(state, dictionary);
  } else if (isDividerSelection) {
    items = getDividerMenuItems(state, dictionary);
  } else {
    items = getFormattingMenuItems(state, isTemplate, dictionary);
  }

  // Some extensions may be disabled, remove corresponding items
  items = items.filter((item) => {
    if (item.name === "separator") {
      return true;
    }
    if (item.name && !commands[item.name]) {
      return false;
    }
    return true;
  });

  items = filterExcessSeparators(items);
  if (!items.length) {
    return null;
  }

  const showLinkToolbar = link && range;

  return (
    <FloatingToolbar
      active={isActive}
      ref={menuRef}
      width={showLinkToolbar ? 336 : undefined}
    >
      {showLinkToolbar ? (
        <LinkEditor
          key={`${range.from}-${range.to}`}
          dictionary={dictionary}
          view={view}
          mark={range.mark}
          from={range.from}
          to={range.to}
          onShowToast={onShowToast}
          onClickLink={props.onClickLink}
          onSearchLink={props.onSearchLink}
          onCreateLink={onCreateLink ? handleOnCreateLink : undefined}
          onSelectLink={handleOnSelectLink}
        />
      ) : (
        <ToolbarMenu items={items} {...rest} />
      )}
    </FloatingToolbar>
  );
}
