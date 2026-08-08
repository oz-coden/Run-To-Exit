using UnityEngine;
using UnityEngine.InputSystem;

namespace RunToExit.Core
{
    public class CommandManager : MonoBehaviour
    {
        public static CommandManager Instance { get; private set; }

        public NPCController SelectedNPC { get; private set; }
        private bool isTargetingItemUse = false;

        private void Awake()
        {
            if (Instance == null) Instance = this;
            else Destroy(gameObject);
        }

        private void Update()
        {
            if (Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame)
            {
                HandleClick();
            }
        }

        private void HandleClick()
        {
            Vector2 mousePos = Mouse.current.position.ReadValue();
            Vector3 worldPos = Camera.main.ScreenToWorldPoint(new Vector3(mousePos.x, mousePos.y, -Camera.main.transform.position.z));
            Vector2Int gridPos = new Vector2Int(Mathf.RoundToInt(worldPos.x), Mathf.RoundToInt(worldPos.y));

            // 1. NPCをクリックしたか判定
            Collider2D hit = Physics2D.OverlapPoint(worldPos);
            if (hit != null)
            {
                // アイテムアイコンをクリックしたか判定
                HeldItemIcon icon = hit.GetComponent<HeldItemIcon>();
                if (icon != null && icon.Owner is NPCController ownerNPC && ownerNPC == SelectedNPC)
                {
                    isTargetingItemUse = true;
                    Debug.Log("Targeting item use... Click destination.");
                    return;
                }

                NPCController npc = hit.GetComponent<NPCController>();
                if (npc != null && npc.IsRescued)
                {
                    SelectNPC(npc);
                    return; // NPCを選択した場合は移動処理はしない
                }
            }

            // 2. マップをクリックした場合
            if (SelectedNPC != null)
            {
                if (isTargetingItemUse)
                {
                    RunToExit.Map.GridNode node = RunToExit.Map.GridManager.Instance.GetNode(gridPos);
                    InteractableBase targetInteractable = node.GetEntity<InteractableBase>();
                    
                    if (targetInteractable != null)
                    {
                        SelectedNPC.AddCommand(new RunToExit.Core.UseItemCommand(targetInteractable));
                    }
                    else
                    {
                        // 何も無い場合はその場に移動する
                        SelectedNPC.AddCommand(new RunToExit.Core.MoveCommand(gridPos));
                    }
                    isTargetingItemUse = false; // 一度指示したら解除
                }
                else
                {
                    // 普通の移動指示
                    SelectedNPC.AddCommand(new RunToExit.Core.MoveCommand(gridPos));
                }
            }
        }

        public void SelectNPC(NPCController npc)
        {
            isTargetingItemUse = false;

            if (SelectedNPC != null)
            {
                // 以前の選択解除（色を戻すなど）
                var renderer = SelectedNPC.GetComponent<SpriteRenderer>();
                if (renderer != null) renderer.color = Color.white;
            }

            SelectedNPC = npc;
            Debug.Log($"Selected NPC: {npc.gameObject.name}");

            // 選択中の見た目変更
            var newRenderer = SelectedNPC.GetComponent<SpriteRenderer>();
            if (newRenderer != null) newRenderer.color = Color.yellow;
        }

        // 全体への「ついてこい」「待て」指示などは今後追加
    }
}
