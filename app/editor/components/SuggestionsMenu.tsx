import commandScore from "command-score";
import { capitalize } from "lodash";
import { findParentNode } from "prosemirror-utils";
import * as React from "react";
import { Trans } from "react-i18next";
import { VisuallyHidden } from "reakit/VisuallyHidden";
import styled from "styled-components";
import insertFiles from "@shared/editor/commands/insertFiles";
import { EmbedDescriptor } from "@shared/editor/embeds";
import filterExcessSeparators from "@shared/editor/lib/filterExcessSeparators";
import { MenuItem } from "@shared/editor/types";
import { depths, s } from "@shared/styles";
import { getEventFiles } from "@shared/utils/files";
import { AttachmentValidation } from "@shared/validations";
import { Portal } from "~/components/Portal";
import Scrollable from "~/components/Scrollable";
import useDictionary from "~/hooks/useDictionary";
import useToasts from "~/hooks/useToasts";
import { useEditor } from "./EditorContext";
import Input from "./Input";

type TopAnchor = {
  top: number;
  bottom: undefined;
};

type BottomAnchor = {
  top: undefined;
  bottom: number;
};

type LeftAnchor = {
  left: number;
  right: undefined;
};

type RightAnchor = {
  left: undefined;
  right: number;
};

type Position = ((TopAnchor | BottomAnchor) & (LeftAnchor | RightAnchor)) & {
  isAbove: boolean;
};

const defaultPosition: Position = {
  top: 0,
  bottom: undefined,
  left: -10000,
  right: undefined,
  isAbove: false,
};

export type Props<T extends MenuItem = MenuItem> = {
  rtl: boolean;
  isActive: boolean;
  search: string;
  uploadFile?: (file: File) => Promise<string>;
  onFileUploadStart?: () => void;
  onFileUploadStop?: () => void;
  onLinkToolbarOpen?: () => void;
  onClose: (insertNewLine?: boolean) => void;
  onClearSearch: () => void;
  embeds?: EmbedDescriptor[];
  renderMenuItem: (
    item: T,
    index: number,
    options: {
      selected: boolean;
      onClick: () => void;
    }
  ) => React.ReactNode;
  filterable?: boolean;
  items: T[];
};

function SuggestionsMenu<T extends MenuItem>(props: Props<T>) {
  const { view, commands } = useEditor();
  const { showToast: onShowToast } = useToasts();
  const dictionary = useDictionary();
  const menuRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [position, setPosition] = React.useState<Position>(defaultPosition);
  const [insertItem, setInsertItem] = React.useState<
    MenuItem | EmbedDescriptor
  >();
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  const calculatePosition = React.useCallback(
    (props: Props) => {
      if (!props.isActive) {
        return defaultPosition;
      }

      const caretPosition = () => {
        let fromPos;
        let toPos;
        try {
          fromPos = view.coordsAtPos(selection.from);
          toPos = view.coordsAtPos(selection.to, -1);
        } catch (err) {
          console.warn(err);
          return {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
          };
        }

        // ensure that start < end for the menu to be positioned correctly
        return {
          top: Math.min(fromPos.top, toPos.top),
          bottom: Math.max(fromPos.bottom, toPos.bottom),
          left: Math.min(fromPos.left, toPos.left),
          right: Math.max(fromPos.right, toPos.right),
        };
      };

      const { selection } = view.state;
      const ref = menuRef.current;
      const offsetWidth = ref ? ref.offsetWidth : 0;
      const offsetHeight = ref ? ref.offsetHeight : 0;
      const { top, bottom, right, left } = caretPosition();
      const margin = 12;

      const offsetParent = ref?.offsetParent
        ? ref.offsetParent.getBoundingClientRect()
        : ({
            width: 0,
            height: 0,
            top: 0,
            left: 0,
          } as DOMRect);

      let leftPos = Math.min(
        left - offsetParent.left,
        window.innerWidth - offsetParent.left - offsetWidth - margin
      );
      if (props.rtl) {
        leftPos = right - offsetWidth;
      }

      if (top - offsetHeight > margin) {
        return {
          left: leftPos,
          top: undefined,
          bottom: offsetParent.bottom - top,
          right: undefined,
          isAbove: false,
        };
      } else {
        return {
          left: leftPos,
          top: bottom - offsetParent.top,
          bottom: undefined,
          right: undefined,
          isAbove: true,
        };
      }
    },
    [view]
  );

  React.useEffect(() => {
    if (!props.isActive) {
      return;
    }

    // reset scroll position to top when opening menu as the contents are
    // hidden, not unrendered
    if (menuRef.current) {
      menuRef.current.scroll({ top: 0 });
    }

    setPosition(calculatePosition(props));
    setSelectedIndex(0);
    setInsertItem(undefined);
  }, [calculatePosition, props.isActive]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [props.search]);

  const insertNode = React.useCallback(
    (item: MenuItem | EmbedDescriptor) => {
      props.onClearSearch();

      const command = item.name ? commands[item.name] : undefined;

      if (command) {
        command(item.attrs);
      } else {
        commands[`create${capitalize(item.name)}`](item.attrs);
      }
      if ("appendSpace" in item) {
        const { dispatch } = view;
        dispatch(view.state.tr.insertText(" "));
      }

      props.onClose();
    },
    [commands, props, view]
  );

  const handleClickItem = React.useCallback(
    (item) => {
      switch (item.name) {
        case "image":
          return triggerFilePick(
            AttachmentValidation.imageContentTypes.join(", ")
          );
        case "attachment":
          return triggerFilePick("*");
        case "embed":
          return triggerLinkInput(item);
        case "link": {
          props.onClearSearch();
          props.onClose();
          props.onLinkToolbarOpen?.();
          return;
        }
        default:
          insertNode(item);
      }
    },
    [insertNode, props]
  );

  const close = React.useCallback(() => {
    props.onClose();
    view.focus();
  }, [props, view]);

  const handleLinkInputKeydown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (!props.isActive) {
      return;
    }
    if (!insertItem) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();

      const href = event.currentTarget.value;
      const matches = "matcher" in insertItem && insertItem.matcher(href);

      if (!matches) {
        onShowToast(dictionary.embedInvalidLink);
        return;
      }

      insertNode({
        name: "embed",
        attrs: {
          href,
        },
      });
    }

    if (event.key === "Escape") {
      props.onClose();
      view.focus();
    }
  };

  const handleLinkInputPaste = (
    event: React.ClipboardEvent<HTMLInputElement>
  ) => {
    if (!props.isActive) {
      return;
    }
    if (!insertItem) {
      return;
    }

    const href = event.clipboardData.getData("text/plain");
    const matches = "matcher" in insertItem && insertItem.matcher(href);

    if (matches) {
      event.preventDefault();
      event.stopPropagation();

      insertNode({
        name: "embed",
        attrs: {
          href,
        },
      });
    }
  };

  const triggerFilePick = (accept: string) => {
    if (inputRef.current) {
      if (accept) {
        inputRef.current.accept = accept;
      }
      inputRef.current.click();
    }
  };

  const triggerLinkInput = (item: MenuItem) => {
    setInsertItem(item);
  };

  const handleFilesPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { uploadFile, onFileUploadStart, onFileUploadStop } = props;
    const files = getEventFiles(event);
    const parent = findParentNode((node) => !!node)(view.state.selection);

    props.onClearSearch();

    if (!uploadFile) {
      throw new Error("uploadFile prop is required to replace files");
    }

    if (parent) {
      insertFiles(view, event, parent.pos, files, {
        uploadFile,
        onFileUploadStart,
        onFileUploadStop,
        onShowToast,
        dictionary,
        isAttachment: inputRef.current?.accept === "*",
      });
    }

    if (inputRef.current) {
      inputRef.current.value = "";
    }

    props.onClose();
  };

  const filtered = React.useMemo(() => {
    const { embeds = [], search = "", uploadFile, filterable = true } = props;
    let items: (EmbedDescriptor | MenuItem)[] = [...props.items];
    const embedItems: EmbedDescriptor[] = [];

    for (const embed of embeds) {
      if (embed.title && embed.visible !== false) {
        embedItems.push(
          new EmbedDescriptor({
            ...embed,
            name: "embed",
          })
        );
      }
    }

    if (embedItems.length) {
      items = items.concat(
        {
          name: "separator",
        },
        embedItems
      );
    }

    const searchInput = search.toLowerCase();
    const filtered = items.filter((item) => {
      if (item.name === "separator") {
        return true;
      }

      // Some extensions may be disabled, remove corresponding menu items
      if (
        item.name &&
        !commands[item.name] &&
        !commands[`create${capitalize(item.name)}`]
      ) {
        return false;
      }

      // If no image upload callback has been passed, filter the image block out
      if (!uploadFile && item.name === "image") {
        return false;
      }

      // some items (defaultHidden) are not visible until a search query exists
      if (!search) {
        return !item.defaultHidden;
      }

      if (!filterable) {
        return item;
      }

      return (
        (item.title || "").toLowerCase().includes(searchInput) ||
        (item.keywords || "").toLowerCase().includes(searchInput)
      );
    });

    return filterExcessSeparators(
      filtered.sort((item) =>
        searchInput && item.title ? commandScore(item.title, searchInput) : 0
      )
    );
  }, [commands, props]);

  React.useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (
        !menuRef.current ||
        menuRef.current.contains(event.target as Element)
      ) {
        return;
      }

      props.onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!props.isActive) {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();

        const item = filtered[selectedIndex];

        if (item) {
          handleClickItem(item);
        } else {
          props.onClose(true);
        }
      }

      if (
        event.key === "ArrowUp" ||
        (event.key === "Tab" && event.shiftKey) ||
        (event.ctrlKey && event.key === "p")
      ) {
        event.preventDefault();
        event.stopPropagation();

        if (filtered.length) {
          const prevIndex = selectedIndex - 1;
          const prev = filtered[prevIndex];

          setSelectedIndex(
            Math.max(0, prev?.name === "separator" ? prevIndex - 1 : prevIndex)
          );
        } else {
          close();
        }
      }

      if (
        event.key === "ArrowDown" ||
        (event.key === "Tab" && !event.shiftKey) ||
        (event.ctrlKey && event.key === "n")
      ) {
        event.preventDefault();
        event.stopPropagation();

        if (filtered.length) {
          const total = filtered.length - 1;
          const nextIndex = selectedIndex + 1;
          const next = filtered[nextIndex];

          setSelectedIndex(
            Math.min(
              next?.name === "separator" ? nextIndex + 1 : nextIndex,
              total
            )
          );
        } else {
          close();
        }
      }

      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown, {
      capture: true,
    });

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown, {
        capture: true,
      });
    };
  }, [close, filtered, handleClickItem, props, selectedIndex]);

  const { isActive, uploadFile } = props;
  const items = filtered;

  return (
    <Portal>
      <Wrapper active={isActive} ref={menuRef} hiddenScrollbars {...position}>
        {insertItem ? (
          <LinkInputWrapper>
            <LinkInput
              type="text"
              placeholder={
                insertItem.title
                  ? dictionary.pasteLinkWithTitle(insertItem.title)
                  : dictionary.pasteLink
              }
              onKeyDown={handleLinkInputKeydown}
              onPaste={handleLinkInputPaste}
              autoFocus
            />
          </LinkInputWrapper>
        ) : (
          <List>
            {items.map((item, index) => {
              if (item.name === "separator") {
                return (
                  <ListItem key={index}>
                    <hr />
                  </ListItem>
                );
              }

              if (!item.title) {
                return null;
              }

              const handlePointer = () => {
                if (selectedIndex !== index) {
                  setSelectedIndex(index);
                }
              };

              return (
                <ListItem
                  key={index}
                  onPointerMove={handlePointer}
                  onPointerDown={handlePointer}
                >
                  {props.renderMenuItem(item as any, index, {
                    selected: index === selectedIndex,
                    onClick: () => handleClickItem(item),
                  })}
                </ListItem>
              );
            })}
            {items.length === 0 && (
              <ListItem>
                <Empty>{dictionary.noResults}</Empty>
              </ListItem>
            )}
          </List>
        )}
        {uploadFile && (
          <VisuallyHidden>
            <label>
              <Trans>Import document</Trans>
              <input
                type="file"
                ref={inputRef}
                onChange={handleFilesPicked}
                multiple
              />
            </label>
          </VisuallyHidden>
        )}
      </Wrapper>
    </Portal>
  );
}

const LinkInputWrapper = styled.div`
  margin: 8px;
`;

const LinkInput = styled(Input)`
  height: 32px;
  width: 100%;
  color: ${s("textSecondary")};
`;

const List = styled.ol`
  list-style: none;
  text-align: left;
  height: 100%;
  padding: 6px;
  margin: 0;
`;

const ListItem = styled.li`
  padding: 0;
  margin: 0;
`;

const Empty = styled.div`
  display: flex;
  align-items: center;
  color: ${s("textSecondary")};
  font-weight: 500;
  font-size: 14px;
  height: 32px;
  padding: 0 16px;
`;

export const Wrapper = styled(Scrollable)<{
  active: boolean;
  top?: number;
  bottom?: number;
  left?: number;
  isAbove: boolean;
}>`
  color: ${s("textSecondary")};
  font-family: ${s("fontFamily")};
  position: absolute;
  z-index: ${depths.editorToolbar};
  ${(props) => props.top !== undefined && `top: ${props.top}px`};
  ${(props) => props.bottom !== undefined && `bottom: ${props.bottom}px`};
  left: ${(props) => props.left}px;
  background: ${s("menuBackground")};
  border-radius: 6px;
  box-shadow: rgba(0, 0, 0, 0.05) 0px 0px 0px 1px,
    rgba(0, 0, 0, 0.08) 0px 4px 8px, rgba(0, 0, 0, 0.08) 0px 2px 4px;
  opacity: 0;
  transform: scale(0.95);
  transition: opacity 150ms cubic-bezier(0.175, 0.885, 0.32, 1.275),
    transform 150ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
  transition-delay: 150ms;
  line-height: 0;
  box-sizing: border-box;
  pointer-events: none;
  white-space: nowrap;
  width: 280px;
  height: auto;
  max-height: 324px;

  * {
    box-sizing: border-box;
  }

  hr {
    border: 0;
    height: 0;
    border-top: 1px solid ${s("divider")};
  }

  ${({ active, isAbove }) =>
    active &&
    `
    transform: translateY(${isAbove ? "6px" : "-6px"}) scale(1);
    pointer-events: all;
    opacity: 1;
  `};

  @media print {
    display: none;
  }
`;

export default SuggestionsMenu;
