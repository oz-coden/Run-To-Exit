using System.Collections;
using UnityEngine;

namespace RunToExit.Core
{
    public abstract class CharacterBase : MonoBehaviour, IGridEntity
    {
        public CharacterState State { get; protected set; } = CharacterState.Idle;
        public Vector2Int GridPosition { get; protected set; }
        
        public bool IsInteractable => false;
        public void OnInteract(CharacterBase character) {}
        public bool IsSolidTo(CharacterBase character) => true;
        [Header("Character Stats")]
        public int Power = 1;
        public float MoveSpeed = 5f;
        public float FallSpeed = 10f;
        public int ClimbLimit = 3;

        public enum CharacterState
        {
            Idle,
            Walking,
            Falling,
            Jumping,      // 段差ジャンプ(+1)
            Hanging,      // ぶら下がり
            Climbing,     // よじ登り
            LongJumping,  // 幅跳び
            ClimbingLadder, // ハシゴ昇降
            WalkingStairs   // 階段移動
        }

        public int FacingDirection { get; set; } = 1;

        protected float visualYOffset = 0f;

        protected virtual void Start()
        {
            InitializePosition();
            GridManager.Instance.AddEntity(this);
            // Y座標の初期オフセットを記録（MapGenerator等で+0.5された場合への対応）
            visualYOffset = transform.position.y - Mathf.Floor(transform.position.y);
        }

        protected virtual void OnDestroy()
        {
            if (GridManager.Instance != null)
            {
                GridManager.Instance.RemoveEntity(this);
            }
        }

        public void InitializePosition()
        {
            GridPosition = new Vector2Int(
                Mathf.RoundToInt(transform.position.x), 
                Mathf.RoundToInt(transform.position.y - visualYOffset)
            );
        }

        public ItemType? HeldItem { get; protected set; }
        private GameObject heldItemVisual;

        // キャラクターは2マスサイズ（足元と頭上）
        public virtual bool CanMoveTo(Vector2Int targetPos, out MovableBox pushableBox, out NPCController npcHit, out InteractableBase interactable)
        {
            pushableBox = null;
            npcHit = null;
            interactable = null;

            Vector2Int footPos = targetPos;
            Vector2Int headPos = targetPos + Vector2Int.up;

            Collider2D hitFoot = GridManager.Instance.GetObjectAt(footPos);
            Collider2D hitHead = GridManager.Instance.GetObjectAt(headPos);

            // 自分自身は無視
            if (hitFoot != null && hitFoot.gameObject == gameObject) hitFoot = null;
            if (hitHead != null && hitHead.gameObject == gameObject) hitHead = null;

            if (hitFoot == null && hitHead == null) return true; // 空いている

            // 壁チェック
            if ((hitFoot != null && hitFoot.CompareTag(TagName.Wall)) || 
                (hitHead != null && hitHead.CompareTag(TagName.Wall)))
            {
                return false;
            }

            GridNode footNode = GridManager.Instance.GetNode(targetPos);
            GridNode headNode = GridManager.Instance.GetNode(targetPos + Vector2Int.up);

            if (footNode.IsWall || headNode.IsWall) return false;

            bool footIsObstacle = false;
            bool headIsObstacle = false;

            foreach (var entity in footNode.Entities)
            {
                if (entity is NPCController npc) npcHit = npc;
                if (entity is InteractableBase inter)
                {
                    interactable = inter;
                    if (inter.IsSolidTo(this)) footIsObstacle = true;
                }
                else if (entity is MovableBox box)
                {
                    pushableBox = box;
                    footIsObstacle = true;
                }
                else if (entity.IsSolidTo(this)) footIsObstacle = true;
            }

            foreach (var entity in headNode.Entities)
            {
                if (npcHit == null && entity is NPCController npc) npcHit = npc;
                if (entity is InteractableBase inter)
                {
                    if (interactable == null) interactable = inter;
                    if (inter.IsSolidTo(this)) headIsObstacle = true;
                }
                else if (entity.IsSolidTo(this)) headIsObstacle = true;
            }

            if (footIsObstacle || headIsObstacle) return false;

            return true;
        }

        protected IEnumerator MoveRoutine(Vector2Int targetPos, MovableBox boxToPush = null)
        {
            State = CharacterState.Walking;

            if (boxToPush != null)
            {
                Vector2Int boxTarget = targetPos + (targetPos - GridPosition);
                boxToPush.PushTo(boxTarget);
            }

            GridManager.Instance.MoveEntity(this, GridPosition, targetPos);
            GridPosition = targetPos;
            int dirX = targetPos.x > GridPosition.x ? 1 : (targetPos.x < GridPosition.x ? -1 : 0);
            if (dirX != 0) FacingDirection = dirX;

            Vector3 endPos = new Vector3(targetPos.x, targetPos.y + visualYOffset, 0);
            while (Vector3.Distance(transform.position, endPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, endPos, MoveSpeed * Time.deltaTime);
                yield return null;
            }
            transform.position = endPos;
            State = CharacterState.Idle;

            CheckFall();
        }

        public virtual void CheckFall()
        {
            if (State != CharacterState.Idle) return;

            if (GridManager.Instance.GetNode(GridPosition).GetEntity<Ladder>() != null) return;

            Vector2Int below = GridPosition + Vector2Int.down;
            GridNode node = GridManager.Instance.GetNode(below);

            if (!node.IsSolid(this))
            {
                StartCoroutine(FallRoutine());
            }
        }

        protected IEnumerator FallRoutine()
        {
            State = CharacterState.Falling;
            
            while (true)
            {
                Vector2Int below = GridPosition + Vector2Int.down;
                GridNode node = GridManager.Instance.GetNode(below);
                
                if (node.IsSolid(this))
                {
                    break;
                }
                
                Vector3 endPos = transform.position + Vector3.down;
                while (Vector3.Distance(transform.position, endPos) > 0.01f)
                {
                    transform.position = Vector3.MoveTowards(transform.position, endPos, FallSpeed * Time.deltaTime);
                    yield return null;
                }
                transform.position = endPos;

                GridManager.Instance.MoveEntity(this, GridPosition, below);
                GridPosition = below;
            }
            
            State = CharacterState.Idle;
            CheckFall();
        }

        public virtual bool TryMove(int dirX)
        {
            Vector2Int targetPos = GridPosition + new Vector2Int(dirX, 0);
            if (CanMoveTo(targetPos, out MovableBox boxToPush, out NPCController npcHit, out InteractableBase interactable))
            {
                StartCoroutine(MoveRoutine(targetPos, boxToPush));
                return true;
            }
            return false;
        }

        public virtual bool TryStepUp(Vector2Int targetPos)
        {
            Vector2Int currentAboveHead = GridPosition + Vector2Int.up * 2;
            Vector2Int targetStep = targetPos + Vector2Int.up;
            Vector2Int targetAboveHead = targetStep + Vector2Int.up;

            if (GridManager.Instance.GetNode(currentAboveHead).IsSolid(this)) return false;
            if (GridManager.Instance.GetNode(targetStep).IsSolid(this)) return false;
            if (GridManager.Instance.GetNode(targetAboveHead).IsSolid(this)) return false;

            if (!GridManager.Instance.GetNode(targetPos).IsSolid(this)) return false;

            StartCoroutine(StepUpRoutine(targetStep));
            return true;
        }

        protected IEnumerator StepUpRoutine(Vector2Int targetStep)
        {
            State = CharacterState.Jumping;

            Vector3 upPos = transform.position + Vector3.up;
            while (Vector3.Distance(transform.position, upPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, upPos, MoveSpeed * 1.5f * Time.deltaTime);
                yield return null;
            }
            transform.position = upPos;

            Vector3 forwardPos = new Vector3(targetStep.x, targetStep.y + visualYOffset, 0);
            while (Vector3.Distance(transform.position, forwardPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, forwardPos, MoveSpeed * 1.5f * Time.deltaTime);
                yield return null;
            }
            transform.position = forwardPos;

            State = CharacterState.Idle;
            CheckFall();
        }

        public virtual bool TryLongJump(int dirX)
        {
            for (int dist = 2; dist <= 4; dist++)
            {
                Vector2Int landPos = GridPosition + new Vector2Int(dirX * dist, 0);
                Vector2Int belowLandPos = landPos + Vector2Int.down;

                if (GridManager.Instance.GetNode(landPos).IsSolid(this)) continue;
                if (GridManager.Instance.GetNode(landPos + Vector2Int.up).IsSolid(this)) continue;
                if (!GridManager.Instance.GetNode(belowLandPos).IsSolid(this)) continue;

                bool pathClear = true;
                for (int i = 1; i < dist; i++)
                {
                    Vector2Int pathPos = GridPosition + new Vector2Int(dirX * i, 0);
                    if (GridManager.Instance.GetNode(pathPos).IsSolid(this) || 
                        GridManager.Instance.GetNode(pathPos + Vector2Int.up).IsSolid(this))
                    {
                        pathClear = false;
                        break;
                    }
                }

                if (pathClear)
                {
                    StartCoroutine(LongJumpRoutine(landPos));
                    return true;
                }
            }
            return false;
        }

        protected IEnumerator LongJumpRoutine(Vector2Int landPos)
        {
            State = CharacterState.LongJumping;
            if (landPos.x != GridPosition.x) FacingDirection = landPos.x > GridPosition.x ? 1 : -1;

            Vector3 startPos = transform.position;
            Vector3 endPos = new Vector3(landPos.x, landPos.y + visualYOffset, 0);
            float duration = Vector3.Distance(startPos, endPos) / (MoveSpeed * 1.5f);
            float elapsed = 0f;

            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float t = elapsed / duration;
                
                Vector3 currentPos = Vector3.Lerp(startPos, endPos, t);
                currentPos.y += Mathf.Sin(t * Mathf.PI) * 0.5f;

                transform.position = currentPos;
                yield return null;
            }

            transform.position = endPos;
            State = CharacterState.Idle;
            CheckFall();
        }

        public virtual bool TryLedgeGrab(int dirX)
        {
            for (int h = 2; h <= ClimbLimit; h++)
            {
                Vector2Int grabWallPos = GridPosition + new Vector2Int(dirX, h - 1);
                Vector2Int standPos = GridPosition + new Vector2Int(dirX, h);

                if (!GridManager.Instance.GetNode(grabWallPos).IsSolid(this)) continue;
                if (GridManager.Instance.GetNode(standPos).IsSolid(this)) continue;
                if (GridManager.Instance.GetNode(standPos + Vector2Int.up).IsSolid(this)) continue;

                StartCoroutine(LedgeGrabRoutine(h, standPos));
                return true;
            }
            return false;
        }

        protected IEnumerator LedgeGrabRoutine(int height, Vector2Int standPos)
        {
            State = CharacterState.Hanging;
            
            Vector2Int hangGridPos = GridPosition + new Vector2Int(0, height - 1);
            Vector3 hangVisualPos = new Vector3(hangGridPos.x, hangGridPos.y + visualYOffset, 0);

            while (Vector3.Distance(transform.position, hangVisualPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, hangVisualPos, MoveSpeed * 1.5f * Time.deltaTime);
                yield return null;
            }
            transform.position = hangVisualPos;

            State = CharacterState.Climbing;

            Vector3 standVisualPos = new Vector3(standPos.x, standPos.y + visualYOffset, 0);
            while (Vector3.Distance(transform.position, standVisualPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, standVisualPos, MoveSpeed * 1.5f * Time.deltaTime);
                yield return null;
            }
            transform.position = standVisualPos;

            State = CharacterState.Idle;
            CheckFall();
        }

        public virtual bool TryClimbLadder(int dirY)
        {
            Vector2Int targetPos = GridPosition + new Vector2Int(0, dirY);
            
            // 自分か移動先がハシゴである必要がある
            bool onLadder = GridManager.Instance.GetNode(GridPosition).GetEntity<Ladder>() != null;
            bool targetHasLadder = GridManager.Instance.GetNode(targetPos).GetEntity<Ladder>() != null;

            if (!onLadder && !targetHasLadder) return false;

            // 頭上や足元に障害物がないか確認
            if (dirY > 0)
            {
                if (GridManager.Instance.GetNode(GridPosition + Vector2Int.up * 2).IsSolid(this)) return false;
            }
            else
            {
                if (GridManager.Instance.GetNode(targetPos).IsSolid(this)) return false;
            }

            StartCoroutine(ClimbLadderRoutine(targetPos));
            return true;
        }

        protected IEnumerator ClimbLadderRoutine(Vector2Int targetPos)
        {
            State = CharacterState.ClimbingLadder;
            GridManager.Instance.MoveEntity(this, GridPosition, targetPos);
            GridPosition = targetPos;

            Vector3 endPos = new Vector3(targetPos.x, targetPos.y + visualYOffset, 0);
            while (Vector3.Distance(transform.position, endPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, endPos, MoveSpeed * Time.deltaTime);
                yield return null;
            }
            transform.position = endPos;
            State = CharacterState.Idle;
            CheckFall();
        }

        public virtual bool TryMoveStairs(Vector2Int targetPos)
        {
            // 階段の移動先には障害物がないこと
            if (GridManager.Instance.GetNode(targetPos).IsSolid(this) ||
                GridManager.Instance.GetNode(targetPos + Vector2Int.up).IsSolid(this))
            {
                return false;
            }

            StartCoroutine(MoveStairsRoutine(targetPos));
            return true;
        }

        protected IEnumerator MoveStairsRoutine(Vector2Int targetPos)
        {
            State = CharacterState.WalkingStairs;
            int dirX = targetPos.x > GridPosition.x ? 1 : -1;
            FacingDirection = dirX;

            GridManager.Instance.MoveEntity(this, GridPosition, targetPos);
            GridPosition = targetPos;

            Vector3 endPos = new Vector3(targetPos.x, targetPos.y + visualYOffset, 0);
            while (Vector3.Distance(transform.position, endPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, endPos, MoveSpeed * Time.deltaTime);
                yield return null;
            }
            transform.position = endPos;
            State = CharacterState.Idle;
            CheckFall();
        }

        public virtual bool IsSolidPlatform(Collider2D hit)
        {
            if (hit == null) return false;
            return hit.CompareTag(TagName.Wall) || hit.GetComponent<MovableBox>() != null;
        }

        public virtual bool TryAutoClimb(int dirY)
        {
            if (GridManager.Instance.GetNode(GridPosition).GetEntity<Ladder>() == null &&
                GridManager.Instance.GetNode(GridPosition + Vector2Int.up).GetEntity<Ladder>() == null)
            {
                // 足元にも頭上にもハシゴがなければ登れない
                return false;
            }

            StartCoroutine(AutoClimbRoutine(dirY));
            return true;
        }

        protected IEnumerator AutoClimbRoutine(int dirY)
        {
            State = CharacterState.ClimbingLadder;
            Vector2Int currentPos = GridPosition;

            while (true)
            {
                Vector2Int nextPos = currentPos + new Vector2Int(0, dirY);
                GridNode nextNode = GridManager.Instance.GetNode(nextPos);
                GridNode nextHeadNode = GridManager.Instance.GetNode(nextPos + Vector2Int.up);

                // 上下どちらかに進む際、その先が完全にハシゴ外か、壁なら終了
                if (dirY > 0 && nextNode.GetEntity<Ladder>() == null && nextHeadNode.GetEntity<Ladder>() == null && nextNode.IsSolid(this))
                    break;
                if (dirY < 0 && currentPos.y > 0 && GridManager.Instance.GetNode(currentPos + Vector2Int.down).GetEntity<Ladder>() == null && nextNode.IsSolid(this))
                    break;

                // 頭上か足元のどちらかにハシゴがあれば進める（上端で頭上が空でも登れるように）
                bool canClimb = false;
                if (dirY > 0 && (nextNode.GetEntity<Ladder>() != null || nextHeadNode.GetEntity<Ladder>() != null || !nextNode.IsSolid(this)))
                    canClimb = true;
                if (dirY < 0 && (nextNode.GetEntity<Ladder>() != null || GridManager.Instance.GetNode(currentPos).GetEntity<Ladder>() != null))
                    canClimb = true;

                if (!canClimb || nextNode.IsSolid(this))
                {
                    break;
                }

                Vector3 targetVisualPos = new Vector3(nextPos.x, nextPos.y + visualYOffset, 0);
                while (Vector3.Distance(transform.position, targetVisualPos) > 0.01f)
                {
                    transform.position = Vector3.MoveTowards(transform.position, targetVisualPos, MoveSpeed * Time.deltaTime);
                    yield return null;
                }
                transform.position = targetVisualPos;
                currentPos = nextPos;
            }

            GridPosition = currentPos;
            State = CharacterState.Idle;
            CheckFall();
        }

        public virtual bool TryAutoStairs(int dirX)
        {
            Stairs currentStairs = GridManager.Instance.GetNode(GridPosition).GetEntity<Stairs>();
            if (currentStairs != null)
            {
                StartCoroutine(AutoStairsRoutine(dirX));
                return true;
            }

            Vector2Int nextPos = GridPosition + new Vector2Int(dirX, 0);
            Stairs nextStairs = GridManager.Instance.GetNode(nextPos).GetEntity<Stairs>();
            if (nextStairs != null)
            {
                StartCoroutine(AutoStairsRoutine(dirX));
                return true;
            }

            return false;
        }

        protected IEnumerator AutoStairsRoutine(int dirX)
        {
            State = CharacterState.WalkingStairs;
            Vector2Int currentPos = GridPosition;
            FacingDirection = dirX;

            while (true)
            {
                Stairs stairs = GridManager.Instance.GetNode(currentPos).GetEntity<Stairs>();
                
                // 次のマスを探す
                Vector2Int nextPos = currentPos;

                if (stairs != null)
                {
                    if (stairs.Direction == StairDirection.RightUp) // '/' 階段 (左下から右上)
                    {
                        nextPos = currentPos + new Vector2Int(dirX, dirX > 0 ? 1 : -1);
                    }
                    else // '\' 階段 (左上から右下)
                    {
                        nextPos = currentPos + new Vector2Int(dirX, dirX > 0 ? -1 : 1);
                    }
                }
                else
                {
                    // 階段が終わった場合、水平移動を試みる
                    nextPos = currentPos + new Vector2Int(dirX, 0);
                }

                if (GridManager.Instance.GetNode(nextPos).IsSolid(this))
                {
                    break;
                }

                Vector3 targetVisualPos = new Vector3(nextPos.x, nextPos.y + visualYOffset, 0);
                while (Vector3.Distance(transform.position, targetVisualPos) > 0.01f)
                {
                    transform.position = Vector3.MoveTowards(transform.position, targetVisualPos, MoveSpeed * Time.deltaTime);
                    yield return null;
                }
                transform.position = targetVisualPos;
                currentPos = nextPos;

                // 移動先が階段でなければ終了
                if (GridManager.Instance.GetNode(currentPos).GetEntity<Stairs>() == null)
                {
                    // さらにその足元が階段かどうかチェック
                    if (GridManager.Instance.GetNode(currentPos + Vector2Int.down).GetEntity<Stairs>() == null)
                    {
                        break;
                    }
                }
            }

            GridPosition = currentPos;
            State = CharacterState.Idle;
            CheckFall();
        }

        public void PickUpItem(ItemBase item)
        {
            HeldItem = item.itemType;
            Debug.Log($"{gameObject.name} picked up {HeldItem}");

            // 見た目の設定（頭上に表示）
            if (heldItemVisual == null)
            {
                heldItemVisual = new GameObject("HeldItemVisual");
                heldItemVisual.transform.SetParent(transform);
                heldItemVisual.transform.localPosition = new Vector3(0, 1.5f, 0); // 頭上
                var sr = heldItemVisual.AddComponent<SpriteRenderer>();
                sr.sprite = item.GetComponent<SpriteRenderer>()?.sprite; // 同じスプライトをコピー
                sr.sortingOrder = 10;
                
                var col = heldItemVisual.AddComponent<BoxCollider2D>();
                col.isTrigger = true;
                var icon = heldItemVisual.AddComponent<HeldItemIcon>();
                icon.Owner = this;
            }
            else
            {
                heldItemVisual.SetActive(true);
                heldItemVisual.GetComponent<SpriteRenderer>().sprite = item.GetComponent<SpriteRenderer>()?.sprite;
            }

            // 元のアイテムオブジェクトは消す
            Destroy(item.gameObject);
        }

        public void ConsumeItem()
        {
            HeldItem = null;
            if (heldItemVisual != null) heldItemVisual.SetActive(false);
        }

        public void UseItemOn(InteractableBase target)
        {
            if (target == null) return;

            if (HeldItem == ItemType.Extinguisher && target is FireHazard fire)
            {
                fire.Extinguish();
                ConsumeItem();
            }
            else if (target is Door door)
            {
                door.OnInteract(this);
            }
            else if (target is RopeAnchor anchor)
            {
                anchor.OnInteract(this);
            }
            else
            {
                target.OnInteract(this);
            }
        }
    }
}
